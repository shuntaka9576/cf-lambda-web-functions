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
const appNextDir = path.resolve(__dirname, '../app-next');

// Next.js standalone の ISR が Web Functions 上でどう振る舞うかを確かめるスタック
export class NextWebFunctionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const functionName = 'cf-lambda-web-functions-next';

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

    // next build はビルドごとに build ID が変わるため、出力ではなくソースでハッシュを取る。
    // そうしないと synth のたびに revision が作り直される
    const code = new s3deploy.BucketDeployment(this, 'CodeDeployment', {
      sources: [
        s3deploy.Source.asset(appNextDir, {
          assetHashType: cdk.AssetHashType.SOURCE,
          exclude: ['node_modules', '.next', 'next-env.d.ts', '*.tsbuildinfo'],
          bundling: {
            image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/node:24'),
            local: {
              tryBundle(outputDir) {
                execSync('bun install --frozen-lockfile && bun run build', {
                  cwd: appNextDir,
                  stdio: 'inherit',
                });
                // standalone の server.js は public と .next/static を自分では持たないのでコピーする
                fs.cpSync(path.join(appNextDir, '.next/standalone'), outputDir, { recursive: true });
                fs.cpSync(
                  path.join(appNextDir, '.next/static'),
                  path.join(outputDir, '.next/static'),
                  { recursive: true },
                );
                const publicDir = path.join(appNextDir, 'public');
                if (fs.existsSync(publicDir)) {
                  fs.cpSync(publicDir, path.join(outputDir, 'public'), { recursive: true });
                }
                // runtime が既定で読む index.js から server.js を起動する
                fs.copyFileSync(
                  path.join(appNextDir, 'lambda/index.js'),
                  path.join(outputDir, 'index.js'),
                );
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
        // 少ない並列でも実行環境が複数立つようにし、環境ごとのキャッシュのズレを観察しやすくする
        maxConcurrencyPerEnvironment: 2,
        // incremental cache の get/set をログに出す
        environmentVariables: { NEXT_PRIVATE_DEBUG_CACHE: '1' },
      },
    });
    revision.node.addDependency(codeBucket.policy!);

    // CloudFront (OAC) 経由で使う本番相当のエンドポイント
    const prodEndpoint = new lambda.CfnWebFunctionEndpoint(this, 'ProdEndpoint', {
      functionName: webFunction.attrFunctionArn,
      endpointName: 'prod',
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
    });

    // CloudFront を挟まずにオリジン単体の ISR を見るためのエンドポイント。
    // 認証が無いので流量と環境数を絞る。検証が終わったらスタックごと消す
    const directEndpoint = new lambda.CfnWebFunctionEndpoint(this, 'DirectEndpoint', {
      functionName: webFunction.attrFunctionArn,
      endpointName: 'direct',
      endpointType: 'HomeRegion',
      authType: 'ApplicationManaged',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
      scalingConfig: { maxEnvironments: 5 },
      throttleConfig: { rateLimit: 100 },
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

    // ISR ページの TTL は Next.js が返す s-maxage / stale-while-revalidate に任せる。
    // App Router は同じ URL で HTML と RSC ペイロードを返し分けるので、
    // Vary に出るヘッダーをキャッシュキーに入れて混ざらないようにする
    const isrCachePolicy = new cloudfront.CachePolicy(this, 'IsrCachePolicy', {
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(365),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'RSC',
        'Next-Router-State-Tree',
        'Next-Router-Prefetch',
        'Next-Router-Segment-Prefetch',
      ),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const origin = new origins.HttpOrigin(prodEndpoint.attrDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originAccessControlId: oac.attrId,
    });
    const behavior = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // Host を転送すると Web Function が自分宛てと判定できず 404 を返す
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        ...behavior,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      additionalBehaviors: {
        '/isr*': { ...behavior, cachePolicy: isrCachePolicy },
        // ファイル名にハッシュが入った immutable なアセット
        '/_next/static/*': { ...behavior, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED },
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
            resources: [prodEndpoint.attrEndpointArn],
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
    new cdk.CfnOutput(this, 'ProdEndpointUrl', {
      value: `https://${prodEndpoint.attrDomainName}`,
    });
    new cdk.CfnOutput(this, 'DirectEndpointUrl', {
      value: `https://${directEndpoint.attrDomainName}`,
    });
  }
}
