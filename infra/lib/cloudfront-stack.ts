import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface CloudFrontStackProps extends cdk.StackProps {
  stage: string;
  bucket: s3.IBucket;
}

export class CloudFrontStack extends cdk.Stack {
  public readonly distribution: cloudfront.CfnDistribution;
  public readonly distributionDomainName: string;
  public readonly distributionId: string;
  public readonly oacId: string;

  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);

    const { stage, bucket } = props;

    // Create Origin Access Control (OAC) using L2 construct
    const oac = new cloudfront.S3OriginAccessControl(this, "OAC", {
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    this.oacId = oac.originAccessControlId;

    // Create cache policy for images (365-day TTL)
    const imageCachePolicy = new cloudfront.CachePolicy(
      this,
      "ImageCachePolicy",
      {
        cachePolicyName: `localstays-${stage}-image-cache`,
        comment: "Cache policy for listing images and profile photos",

        // Cache for 365 days (maximum performance and cost savings)
        defaultTtl: cdk.Duration.days(365),
        minTtl: cdk.Duration.seconds(0),
        maxTtl: cdk.Duration.days(365),

        // Cache based on query strings (for versioning via ?v= parameter)
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),

        // Don't cache based on headers or cookies
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),

        // Enable compression
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }
    );

    // Create CloudFront distribution using L1 (CFN) construct to avoid automatic bucket policy updates
    const cfnDistribution = new cloudfront.CfnDistribution(
      this,
      "AssetsDistribution",
      {
        distributionConfig: {
          comment: `Localstays ${stage} - Host Assets CDN`,
          enabled: true,

          // Origins configuration
          origins: [
            {
              id: `S3-${bucket.bucketName}`,
              domainName: bucket.bucketRegionalDomainName,
              originAccessControlId: oac.originAccessControlId,
              s3OriginConfig: {}, // Empty object required when using OAC
            },
          ],

          // Default cache behavior (returns 403 for non-whitelisted paths)
          defaultCacheBehavior: {
            targetOriginId: `S3-${bucket.bucketName}`,
            viewerProtocolPolicy: "redirect-to-https",
            allowedMethods: ["GET", "HEAD"],
            cachedMethods: ["GET", "HEAD"],
            cachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
            compress: false,
          },

          // Cache behaviors for whitelisted paths
          cacheBehaviors: [
            {
              pathPattern: "*/listings/*/images/*.webp",
              targetOriginId: `S3-${bucket.bucketName}`,
              viewerProtocolPolicy: "redirect-to-https",
              allowedMethods: ["GET", "HEAD"],
              cachedMethods: ["GET", "HEAD"],
              cachePolicyId: imageCachePolicy.cachePolicyId,
              compress: true,
            },
            {
              pathPattern: "*/profile/*.webp",
              targetOriginId: `S3-${bucket.bucketName}`,
              viewerProtocolPolicy: "redirect-to-https",
              allowedMethods: ["GET", "HEAD"],
              cachedMethods: ["GET", "HEAD"],
              cachePolicyId: imageCachePolicy.cachePolicyId,
              compress: true,
            },
          ],

          // Price class: US, Canada, Europe only (cost optimization)
          priceClass: "PriceClass_100",

          // Enable IPv6 (no extra cost, better connectivity)
          ipv6Enabled: true,

          // HTTP version (HTTP/3 for better performance)
          httpVersion: "http2and3",

          // Logging disabled (cost savings)
          logging: undefined,
        },
      }
    );

    // Store references to the distribution
    this.distribution = cfnDistribution;
    this.distributionId = cfnDistribution.ref;
    this.distributionDomainName = cfnDistribution.attrDomainName;

    // Note: S3 bucket policy must be added manually after deployment
    // Run this command after CloudFront is deployed:
    // aws s3api put-bucket-policy --bucket <bucket-name> --policy file://bucket-policy.json
    // 
    // Policy content:
    // {
    //   "Version": "2012-10-17",
    //   "Statement": [{
    //     "Sid": "AllowCloudFrontServicePrincipal",
    //     "Effect": "Allow",
    //     "Principal": {"Service": "cloudfront.amazonaws.com"},
    //     "Action": "s3:GetObject",
    //     "Resource": "arn:aws:s3:::<bucket-name>/*",
    //     "Condition": {
    //       "StringEquals": {
    //         "AWS:SourceArn": "arn:aws:cloudfront::<account>:distribution/<distribution-id>"
    //       }
    //     }
    //   }]
    // }

    // CloudFormation outputs
    new cdk.CfnOutput(this, "DistributionId", {
      value: cfnDistribution.ref,
      description: "CloudFront distribution ID",
      exportName: `Localstays${this.capitalize(stage)}DistributionId`,
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: this.distributionDomainName,
      description: "CloudFront distribution domain name",
      exportName: `Localstays${this.capitalize(stage)}DistributionDomain`,
    });

    new cdk.CfnOutput(this, "OACId", {
      value: oac.originAccessControlId,
      description: "Origin Access Control ID",
      exportName: `Localstays${this.capitalize(stage)}OACId`,
    });

    // Add tags
    cdk.Tags.of(this).add("Project", "Localstays");
    cdk.Tags.of(this).add("Environment", stage);
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
