import * as cdk from 'aws-cdk-lib';
import { CpuWebFunctionStack } from '../lib/cpu-web-function-stack.js';
import { NextWebFunctionStack } from '../lib/next-web-function-stack.js';
import { RustWebFunctionStack } from '../lib/rust-web-function-stack.js';
import { WebFunctionStack } from '../lib/web-function-stack.js';

const app = new cdk.App();

new WebFunctionStack(app, 'CfLambdaWebFunctions', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});

new NextWebFunctionStack(app, 'CfLambdaWebFunctionsNext', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});

new RustWebFunctionStack(app, 'CfLambdaWebFunctionsRust', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});

new CpuWebFunctionStack(app, 'CfLambdaWebFunctionsCpu', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});
