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
const appRustDir = path.resolve(__dirname, '../app-rust');

// Web Functions のランタイムは Node.js のみ。Node から Rust (Axum) のサーバーを子プロセスで起動して動くかを確かめるスタック
export class RustWebFunctionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const functionName = 'cf-lambda-web-functions-rust';

    // Web Functions のコードはバージョニング有効な S3 バケットの zip からしか読めず、
    // バケットポリシーで lambda.amazonaws.com に読み取りを許可する必要がある
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
            'aws:SourceArn': this.formatArn({
              service: 'lambda',
              resource: 'web-function',
              resourceName: `${functionName}/revision/*`,
            }),
          },
        },
      }),
    );

    const code = new s3deploy.BucketDeployment(this, 'CodeDeployment', {
      sources: [
        s3deploy.Source.asset(appRustDir, {
          assetHashType: cdk.AssetHashType.SOURCE,
          exclude: ['target'],
          bundling: {
            image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/rust:1'),
            // server の実行権限を確実に残すため、CDK に任せず自前で zip する
            outputType: cdk.BundlingOutput.ARCHIVED,
            local: {
              tryBundle(outputDir) {
                // Web Functions は Arm64 固定。実行環境の glibc に依存しないよう musl で静的リンクする
                const target = 'aarch64-unknown-linux-musl';
                execSync(`cargo zigbuild --release --target ${target}`, {
                  cwd: appRustDir,
                  stdio: 'inherit',
                });
                const packageDir = path.join(appRustDir, 'target/lambda-package');
                fs.rmSync(packageDir, { recursive: true, force: true });
                fs.mkdirSync(packageDir, { recursive: true });
                // runtime が既定で読む index.js から、同じディレクトリの server を起動する
                fs.copyFileSync(
                  path.join(appRustDir, 'lambda/index.js'),
                  path.join(packageDir, 'index.js'),
                );
                const server = path.join(packageDir, 'server');
                fs.copyFileSync(path.join(appRustDir, `target/${target}/release/server`), server);
                fs.chmodSync(server, 0o755);
                execSync(`zip -qr ${JSON.stringify(path.join(outputDir, 'app.zip'))} .`, {
                  cwd: packageDir,
                });
                return true;
              },
            },
          },
        }),
      ],
      destinationBucket: codeBucket,
      extract: false,
      // 稼働中の revision が参照するオブジェクトを消すと revision が Failed になるため prune しない
      prune: false,
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const webFunction = new lambda.CfnWebFunction(this, 'WebFunction', {
      functionName,
    });

    const revision = new lambda.CfnWebFunctionRevision(this, 'Revision', {
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
      },
    });
    revision.node.addDependency(codeBucket.policy!);

    const endpoint = new lambda.CfnWebFunctionEndpoint(this, 'Endpoint', {
      functionName: webFunction.attrFunctionArn,
      endpointName: 'prod',
      endpointType: 'HomeRegion',
      // CloudFront OAC から署名付きで呼ばせ、直接アクセスは 403 にする
      authType: 'IamAuth',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
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

    // 画面・SSE・echo のどれもキャッシュしない
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(endpoint.attrDomainName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originAccessControlId: oac.attrId,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Host を転送すると Web Function が自分宛てと判定できず 404 を返す
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    // Web Functions は AddPermission 非対応。リソースポリシーを丸ごと設定する
    new lambda.CfnResourcePolicy(this, 'ResourcePolicy', {
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

    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, 'EndpointUrl', {
      value: `https://${endpoint.attrDomainName}`,
    });
  }
}
