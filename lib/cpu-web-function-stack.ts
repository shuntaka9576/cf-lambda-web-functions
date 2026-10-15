import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appCpuNodeDir = path.resolve(__dirname, '../app-cpu-node');
const appCpuGoDir = path.resolve(__dirname, '../app-cpu-go');
const appCpuUiDir = path.resolve(__dirname, '../app-cpu-ui');

// CPU を使うリクエストが、同じ実行環境のほかのリクエストを待たせるかを Node.js と Go で比べるスタック。
// 計測対象に余計な処理を混ぜないよう、Web Function は実装ごとに分け、計測用の画面は S3 から配る
export class CpuWebFunctionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const functionNames = {
      node: 'cf-lambda-web-functions-cpu-node',
      go: 'cf-lambda-web-functions-cpu-go',
    };
    // runtime は既定で index.js を読む。どちらのエントリも ESM なので .mjs にし、
    // revision の AWS_LAMBDA_NODEJS_ENTRYPOINT で指定する
    const entrypoint = 'index.mjs';

    // Web Functions のコードはバージョニング有効な S3 バケットの zip からしか読めず、
    // バケットポリシーで lambda.amazonaws.com に読み取りを許可する必要がある。2 つの関数で共有する
    const codeBucket = new s3.Bucket(this, 'CodeBucket', {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    codeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [codeBucket.arnForObjects('*')],
        conditions: {
          ArnLike: {
            'aws:SourceArn': Object.values(functionNames).map((name) =>
              this.formatArn({ service: 'lambda', resource: 'web-function', resourceName: `${name}/revision/*` }),
            ),
          },
        },
      }),
    );

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const addWebFunction = (id: string, functionName: string, source: s3deploy.ISource) => {
      const code = new s3deploy.BucketDeployment(this, `${id}CodeDeployment`, {
        sources: [source],
        destinationBucket: codeBucket,
        extract: false,
        // 稼働中の revision が参照するオブジェクトを消すと revision が Failed になるため prune しない
        prune: false,
      });
      const webFunction = new lambda.CfnWebFunction(this, `${id}WebFunction`, { functionName });
      const revision = new lambda.CfnWebFunctionRevision(this, `${id}Revision`, {
        functionName: webFunction.attrFunctionArn,
        buildConfig: {
          codeConfig: {
            s3Object: {
              bucket: codeBucket.bucketName,
              key: cdk.Fn.select(0, code.objectKeys),
              versionId: cdk.Fn.select(0, code.objectVersionIds),
            },
          },
          runtimeConfig: { runtime: 'nodejs24.x' },
        },
        serviceConfig: {
          executionRoleArn: executionRole.roleArn,
          timeoutSeconds: 30,
          environmentVariables: { AWS_LAMBDA_NODEJS_ENTRYPOINT: entrypoint },
        },
      });
      revision.node.addDependency(codeBucket.policy!);
      const endpoint = new lambda.CfnWebFunctionEndpoint(this, `${id}Endpoint`, {
        functionName: webFunction.attrFunctionArn,
        endpointName: 'prod',
        endpointType: 'HomeRegion',
        // CloudFront OAC から署名付きで呼ばせ、直接アクセスは 403 にする
        authType: 'IamAuth',
        revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
        // 環境を 1 つには固定できない（最小値は 2）。上限を最小にして、/hash と /ping が同じ環境に当たりやすくする
        scalingConfig: { maxEnvironments: 2 },
      });
      return { webFunction, endpoint };
    };

    // node:http だけのファイル 1 つなので、ディレクトリをそのまま zip にする
    const node = addWebFunction('Node', functionNames.node, s3deploy.Source.asset(appCpuNodeDir));

    const go = addWebFunction(
      'Go',
      functionNames.go,
      s3deploy.Source.asset(appCpuGoDir, {
        assetHashType: cdk.AssetHashType.SOURCE,
        exclude: ['target'],
        bundling: {
          image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/golang:1'),
          // server の実行権限を確実に残すため、CDK に任せず自前で zip する
          outputType: cdk.BundlingOutput.ARCHIVED,
          local: {
            tryBundle(outputDir) {
              const packageDir = path.join(appCpuGoDir, 'target/lambda-package');
              fs.rmSync(packageDir, { recursive: true, force: true });
              fs.mkdirSync(packageDir, { recursive: true });
              // Web Functions は Arm64 固定。cgo を切って、実行環境のライブラリに依存しない静的バイナリにする
              execSync(`go build -trimpath -ldflags='-s -w' -o ${JSON.stringify(path.join(packageDir, 'server'))} .`, {
                cwd: appCpuGoDir,
                stdio: 'inherit',
                env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'arm64' },
              });
              fs.chmodSync(path.join(packageDir, 'server'), 0o755);
              // runtime が読む index.mjs から、同じディレクトリの server を起動する
              fs.copyFileSync(path.join(appCpuGoDir, 'lambda/index.mjs'), path.join(packageDir, entrypoint));
              execSync(`zip -qr ${JSON.stringify(path.join(outputDir, 'app.zip'))} .`, { cwd: packageDir });
              return true;
            },
          },
        },
      }),
    );

    // 計測用の画面。計測対象の関数に配信を混ぜないよう、S3 に置く
    const uiBucket = new s3.Bucket(this, 'UiBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Web Function オリジンは always-amz-auth のみ対応。L2 の SigningBehavior には無いため L1 で作る
    const oac = new cloudfront.CfnOriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlConfig: {
        name: `${this.stackName}-web-function`,
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always-amz-auth',
        signingProtocol: 'sigv4',
      },
    });
    const webFunctionBehavior = (endpoint: lambda.CfnWebFunctionEndpoint): cloudfront.BehaviorOptions => ({
      origin: new origins.HttpOrigin(endpoint.attrDomainName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originAccessControlId: oac.attrId,
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // 計測のたびに関数まで届かせる
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Host を転送すると Web Function が自分宛てと判定できず 404 を返す
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // / は画面、/node/* は Node.js、/go/* は Go に振り分ける。関数側は接頭辞を外してルーティングする
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // 画面を直したら、すぐ反映されるようにキャッシュしない
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      additionalBehaviors: {
        '/node/*': webFunctionBehavior(node.endpoint),
        '/go/*': webFunctionBehavior(go.endpoint),
      },
    });

    new s3deploy.BucketDeployment(this, 'UiDeployment', {
      sources: [s3deploy.Source.asset(appCpuUiDir)],
      destinationBucket: uiBucket,
    });

    // Web Functions は AddPermission 非対応。リソースポリシーを丸ごと設定する
    for (const [id, { webFunction, endpoint }] of Object.entries({ Node: node, Go: go })) {
      new lambda.CfnResourcePolicy(this, `${id}ResourcePolicy`, {
        resourceArn: webFunction.attrFunctionArn,
        policyDocument: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
              actions: ['lambda:InvokeWebFunctionEndpoint'],
              resources: [endpoint.attrEndpointArn],
              conditions: {
                StringEquals: { 'aws:SourceArn': distribution.distributionArn },
              },
            }),
          ],
        }),
      });
    }

    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
