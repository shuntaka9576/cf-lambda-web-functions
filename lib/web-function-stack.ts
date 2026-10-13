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
import { buildSync } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../app');

export class WebFunctionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const functionName = 'cf-lambda-web-functions';

    // Web Functions のコードはバージョニング有効な S3 バケットの zip からしか読めず、
    // バケットポリシーで lambda.amazonaws.com に読み取りを許可する必要がある。
    // CDK bootstrap のバケットにはポリシーを足せないため専用バケットを用意する
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

    // esbuild で index.js 1ファイルにまとめ、zip のまま専用バケットへ置く。
    // 稼働中の revision が参照するオブジェクトを消すと revision が Failed になるため prune しない
    const code = new s3deploy.BucketDeployment(this, 'CodeDeployment', {
      sources: [
        s3deploy.Source.asset(appDir, {
          assetHashType: cdk.AssetHashType.OUTPUT,
          bundling: {
            image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/node:24'),
            local: {
              tryBundle(outputDir) {
                buildSync({
                  entryPoints: [path.join(appDir, 'src/index.ts')],
                  outfile: path.join(outputDir, 'index.js'),
                  bundle: true,
                  platform: 'node',
                  target: 'node24',
                  format: 'cjs',
                  minify: true,
                });
                return true;
              },
            },
          },
        }),
      ],
      destinationBucket: codeBucket,
      extract: false,
      prune: false,
    });

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Web Functions は L2 が無いため L1 で組む
    const webFunction = new lambda.CfnWebFunction(this, 'WebFunction', {
      functionName,
    });

    // revision はイミュータブル。コードや設定が変わると CloudFormation が置換し、
    // 新しい revision を作成 → endpoint の向き先を更新 → 古い revision を削除の順で進む
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
    // revision 作成時に Lambda がバケットを読めるよう、バケットポリシーの反映を先に済ませる
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

    // GET/HEAD の Authorization はキャッシュキーに含めないと CloudFront に落とされる。
    // TTL がすべて 0 だとキャッシュキーにヘッダーを含められないため maxTtl だけ 1 秒にする
    const cachePolicy = new cloudfront.CachePolicy(this, 'CachePolicy', {
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Authorization'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.all(),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.HttpOrigin(endpoint.attrDomainName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originAccessControlId: oac.attrId,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy,
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
