import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Storage Stack - S3 bucket for host documents and listing images
 * 
 * Structure:
 * - {hostId}/verification/           -> Host verification documents
 * - {hostId}/listings/{listingId}/images/  -> Listing images
 */
export class StorageStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') || 'dev';

    // Create S3 bucket for host assets
    this.bucket = new s3.Bucket(this, 'HostAssetsBucket', {
      bucketName: `localstays-${stage}-host-assets`,
      
      // Versioning for document history and accidental deletion recovery
      versioned: true,
      
      // Encryption at rest
      encryption: s3.BucketEncryption.S3_MANAGED,
      
      // Block public access by default
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      
      // CORS for frontend uploads
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: [
            'http://localhost:3000',
            'https://*.localstays.com', // Production domain
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      
      // Lifecycle rules
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90), // Delete old versions after 90 days
        },
        {
          id: 'AbortIncompleteMultipartUpload',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      
      // Removal policy - RETAIN in production, DESTROY in dev
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      
      // Auto delete objects when stack is deleted (only in dev)
      autoDeleteObjects: stage !== 'prod',
    });

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for host assets',
      exportName: `${stage}-host-assets-bucket-name`,
    });

    new cdk.CfnOutput(this, 'BucketArn', {
      value: this.bucket.bucketArn,
      description: 'ARN of the host assets bucket',
      exportName: `${stage}-host-assets-bucket-arn`,
    });
  }
}

