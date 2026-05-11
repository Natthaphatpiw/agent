import {
  AgentCoreApplication,
  AgentCoreMcp,
  type AgentCoreProjectSpec,
  type AgentCoreMcpSpec,
} from '@aws/agentcore-cdk';
import { CfnOutput, Stack, aws_iam as iam, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AgentCoreStackProps extends StackProps {
  /**
   * The AgentCore project specification containing agents, memories, and credentials.
   */
  spec: AgentCoreProjectSpec;
  /**
   * The MCP specification containing gateways and servers.
   */
  mcpSpec?: AgentCoreMcpSpec;
  /**
   * Credential provider ARNs from deployed state, keyed by credential name.
   */
  credentials?: Record<string, { credentialProviderArn: string; clientSecretArn?: string }>;
}

/**
 * CDK Stack that deploys AgentCore infrastructure.
 *
 * This is a thin wrapper that instantiates L3 constructs.
 * All resource logic and outputs are contained within the L3 constructs.
 */
export class AgentCoreStack extends Stack {
  /** The AgentCore application containing all agent environments */
  public readonly application: AgentCoreApplication;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const { spec, mcpSpec, credentials } = props;

    // Create AgentCoreApplication with all agents
    this.application = new AgentCoreApplication(this, 'Application', {
      spec,
    });
    this.grantSystemInferenceProfileAccess(spec);
    this.grantBedrockMarketplaceModelAccess(spec);
    this.grantExistingMemoryAccess(spec);

    // Create AgentCoreMcp if there are gateways configured
    if (mcpSpec?.agentCoreGateways && mcpSpec.agentCoreGateways.length > 0) {
      new AgentCoreMcp(this, 'Mcp', {
        projectName: spec.name,
        mcpSpec,
        agentCoreApplication: this.application,
        credentials,
        projectTags: spec.tags,
      });
    }

    // Stack-level output
    new CfnOutput(this, 'StackNameOutput', {
      description: 'Name of the CloudFormation Stack',
      value: this.stackName,
    });
  }

  private grantExistingMemoryAccess(spec: AgentCoreProjectSpec): void {
    for (const runtime of spec.runtimes ?? []) {
      const env = this.application.environments.get(runtime.name);
      if (!env) {
        continue;
      }

      const memoryArn = this.getEnvVar(runtime, 'AGENTCORE_MEMORY_ARN');
      const memoryId = this.getEnvVar(runtime, 'AGENTCORE_MEMORY_ID');
      const resolvedMemoryArn =
        memoryArn ??
        (memoryId
          ? this.formatArn({
              service: 'bedrock-agentcore',
              resource: 'memory',
              resourceName: memoryId,
            })
          : undefined);

      if (!resolvedMemoryArn) {
        continue;
      }

      env.runtime.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'bedrock-agentcore:CreateEvent',
            'bedrock-agentcore:DeleteEvent',
            'bedrock-agentcore:DeleteMemoryRecord',
            'bedrock-agentcore:GetEvent',
            'bedrock-agentcore:GetMemory',
            'bedrock-agentcore:GetMemoryRecord',
            'bedrock-agentcore:ListActors',
            'bedrock-agentcore:ListEvents',
            'bedrock-agentcore:ListMemoryRecords',
            'bedrock-agentcore:ListSessions',
            'bedrock-agentcore:RetrieveMemoryRecords',
          ],
          resources: [resolvedMemoryArn],
        }),
      );
    }
  }

  private grantSystemInferenceProfileAccess(spec: AgentCoreProjectSpec): void {
    for (const runtime of spec.runtimes ?? []) {
      const env = this.application.environments.get(runtime.name);
      if (!env) {
        continue;
      }

      env.runtime.addToPolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:GetInferenceProfile', 'bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['arn:aws:bedrock:*::inference-profile/*'],
        }),
      );
    }
  }

  private grantBedrockMarketplaceModelAccess(spec: AgentCoreProjectSpec): void {
    for (const runtime of spec.runtimes ?? []) {
      const env = this.application.environments.get(runtime.name);
      if (!env) {
        continue;
      }

      env.runtime.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'aws-marketplace:Subscribe',
            'aws-marketplace:Unsubscribe',
            'aws-marketplace:ViewSubscriptions',
          ],
          resources: ['*'],
        }),
      );
    }
  }

  private getEnvVar(runtime: AgentCoreProjectSpec['runtimes'][number], name: string): string | undefined {
    const value = runtime.envVars?.find(envVar => envVar.name === name)?.value;
    if (!value || value.startsWith('REPLACE_')) {
      return undefined;
    }
    return value;
  }
}
