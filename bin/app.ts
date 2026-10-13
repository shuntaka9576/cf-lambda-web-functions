import * as cdk from 'aws-cdk-lib';
import { WebFunctionStack } from '../lib/web-function-stack.js';

const app = new cdk.App();

new WebFunctionStack(app, 'CfLambdaWebFunctions', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});
