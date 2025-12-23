import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

/**
 * Properties for WAF Stack
 */
export interface WafStackProps extends cdk.StackProps {
  /** Environment stage (dev1, staging, prod) */
  stage: string;
  /** API Gateway ARNs to protect */
  apiGatewayArns: string[];
}

/**
 * WAF Stack - Web Application Firewall
 * 
 * Implements a cost-effective WAF configuration:
 * - AWS Managed Rules (free): Core Rule Set, Known Bad Inputs, IP Reputation
 * - Custom Rate Limiting rule
 * 
 * Estimated cost: ~$6-8/month
 * 
 * IMPORTANT: Initially deployed in COUNT mode for monitoring.
 * Switch to BLOCK mode after verifying no false positives.
 */
export class WafStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const { stage, apiGatewayArns } = props;

    // Determine if we should block or just count
    // Start in COUNT mode for safety, switch to BLOCK after monitoring
    const actionMode = stage === 'prod' ? 'COUNT' : 'BLOCK';
    
    // For COUNT mode, we use overrideAction: { count: {} }
    // For BLOCK mode, we use overrideAction: { none: {} }
    const managedRuleAction = actionMode === 'COUNT' 
      ? { count: {} } 
      : { none: {} };

    // ========================================
    // Web ACL with Rules
    // ========================================
    this.webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      name: `localstays-${stage}-api-waf`,
      description: `WAF for Localstays ${stage} API Gateways`,
      scope: 'REGIONAL', // For API Gateway (use CLOUDFRONT for CloudFront)
      defaultAction: { allow: {} }, // Allow by default, rules block/count threats
      
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `localstays-${stage}-waf`,
        sampledRequestsEnabled: true,
      },

      rules: [
        // ========================================
        // Rule 1: AWS Managed - Core Rule Set (FREE)
        // Protects against: XSS, SQLi, LFI, RFI, command injection
        // ========================================
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              // Exclude rules that might cause false positives
              excludedRules: [
                // SizeRestrictions can block legitimate large uploads
                { name: 'SizeRestrictions_BODY' },
                // Cross-site scripting in body can trigger on rich text
                { name: 'CrossSiteScripting_BODY' },
              ],
            },
          },
          overrideAction: managedRuleAction,
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${stage}-aws-common-rules`,
            sampledRequestsEnabled: true,
          },
        },

        // ========================================
        // Rule 2: AWS Managed - Known Bad Inputs (FREE)
        // Protects against: Log4j, SSRF, known exploits
        // ========================================
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: managedRuleAction,
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${stage}-aws-bad-inputs`,
            sampledRequestsEnabled: true,
          },
        },

        // ========================================
        // Rule 3: AWS Managed - Amazon IP Reputation List (FREE)
        // Blocks known malicious IPs, botnets, etc.
        // ========================================
        {
          name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          overrideAction: managedRuleAction,
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${stage}-aws-ip-reputation`,
            sampledRequestsEnabled: true,
          },
        },

        // ========================================
        // Rule 4: Custom Rate Limit - Global ($1/month)
        // Limits requests per IP to prevent brute force/DDoS
        // 2000 requests per 5 minutes per IP
        // ========================================
        {
          name: 'RateLimitPerIP',
          priority: 4,
          statement: {
            rateBasedStatement: {
              limit: 2000, // requests per 5-minute window
              aggregateKeyType: 'IP',
            },
          },
          // Rate limit rules use action directly, not overrideAction
          action: actionMode === 'COUNT' ? { count: {} } : { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${stage}-rate-limit-ip`,
            sampledRequestsEnabled: true,
          },
        },
      ],

      // Tags for cost tracking
      tags: [
        { key: 'Environment', value: stage },
        { key: 'Service', value: 'localstays' },
        { key: 'Component', value: 'waf' },
      ],
    });

    // ========================================
    // Associate WAF with each API Gateway
    // ========================================
    apiGatewayArns.forEach((apiArn, index) => {
      new wafv2.CfnWebACLAssociation(this, `WebAclAssociation${index}`, {
        webAclArn: this.webAcl.attrArn,
        resourceArn: apiArn,
      });
    });

    // ========================================
    // CloudFormation Outputs
    // ========================================
    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF Web ACL ARN',
      exportName: `Localstays${this.capitalize(stage)}WafArn`,
    });

    new cdk.CfnOutput(this, 'WebAclId', {
      value: this.webAcl.attrId,
      description: 'WAF Web ACL ID',
      exportName: `Localstays${this.capitalize(stage)}WafId`,
    });

    new cdk.CfnOutput(this, 'ActionMode', {
      value: actionMode,
      description: 'WAF action mode (COUNT = monitoring only, BLOCK = active protection)',
    });
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

