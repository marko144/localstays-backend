import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Properties for StorageStack
 */
export interface StorageStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Storage Stack - S3 bucket for host documents and listing images
 * 
 * Structure:
 * - {hostId}/verification/           -> Host verification documents
 * - {hostId}/listings/{listingId}/images/  -> Listing images
 */
export class StorageStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { stage } = props;

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
          allowedOrigins: stage === 'prod'
            ? ['https://portal.localstays.me', 'https://localstays.me', 'https://www.localstays.me'] // Production only
            : [
                'http://localhost:3000',   // Next.js default
                'http://localhost:5173',   // Vite default
                'http://localhost:8080',   // Common dev port
                'http://127.0.0.1:3000',
                'http://127.0.0.1:5173',
                'http://192.168.4.58:3000', // Local network access
                'https://*.localstays.com',
                'https://*.localstays.me',  // Amplify staging domains
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
        {
          id: 'CleanupUnconfirmedDocuments',
          enabled: true,
          prefix: 'veri_profile-doc_', // Temporary document uploads
          expiration: cdk.Duration.days(7), // Delete after 7 days (gives GuardDuty time to process)
        },
        {
          id: 'CleanupUnconfirmedPhotos',
          enabled: true,
          prefix: 'lstimg_', // Temporary photo uploads
          expiration: cdk.Duration.days(7), // Delete after 7 days (gives processing time)
        },
      ],
      
      // Removal policy - RETAIN in production, DESTROY in dev
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      
      // Auto delete objects when stack is deleted (only in dev)
      autoDeleteObjects: stage !== 'prod',
    });

    // CloudFormation Outputs (with environment-specific export names)
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for host assets',
      exportName: `Localstays${capitalizedStage}BucketName`,
    });

    new cdk.CfnOutput(this, 'BucketArn', {
      value: this.bucket.bucketArn,
      description: 'ARN of the host assets bucket',
      exportName: `Localstays${capitalizedStage}BucketArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

