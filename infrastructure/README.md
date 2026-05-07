# humanovo AWS Infrastructure

Serverless AWS infrastructure for the humanovo Biomedical Discovery Platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  CloudFront                                      │
│                              (CDN + Edge Cache)                                  │
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
           ┌────────▼────────┐               ┌─────────▼─────────┐
           │   S3 Bucket     │               │   API Gateway     │
           │   (Frontend)    │               │   (REST API)      │
           └─────────────────┘               └─────────┬─────────┘
                                                       │
                         ┌─────────────────────────────┼─────────────────────────────┐
                         │                             │                             │
              ┌──────────▼──────────┐     ┌───────────▼───────────┐    ┌────────────▼────────────┐
              │  Lambda: API Core   │     │  Lambda: Hypotheses   │    │  Lambda: Simulation     │
              │  (Projects, Auth)   │     │  (Generation, RAG)    │    │  (Monte Carlo)          │
              └──────────┬──────────┘     └───────────┬───────────┘    └────────────┬────────────┘
                         │                            │                              │
         ┌───────────────┼────────────────────────────┼──────────────────────────────┤
         │               │                            │                              │
┌────────▼────────┐ ┌────▼─────┐ ┌───────────────────▼───────────────────┐ ┌────────▼────────┐
│    DynamoDB     │ │    S3    │ │              Bedrock                  │ │   OpenSearch    │
│  (Metadata)     │ │  (Data)  │ │  (Claude 3.5 Sonnet + Embeddings)    │ │  (Vectors)      │
└─────────────────┘ └──────────┘ └───────────────────────────────────────┘ └─────────────────┘
```

## Components

### Compute
- **Lambda Functions**: Serverless compute for API handlers
- **Lambda Layers**: Shared dependencies (numpy, scipy, etc.)

### Storage
- **S3**: Frontend assets, data lake, model artifacts
- **DynamoDB**: Projects, hypotheses, evidence metadata
- **OpenSearch Serverless**: Vector embeddings for RAG

### API
- **API Gateway (HTTP API)**: REST endpoints with JWT auth
- **CloudFront**: CDN with edge caching

### AI/ML
- **Bedrock**: Claude 3.5 Sonnet for hypothesis generation
- **Bedrock Embeddings**: Titan for vector embeddings

## Quick Start

```bash
# Prerequisites
- AWS CLI configured
- Terraform >= 1.5
- Node.js 18+ (for frontend build)
- Python 3.11+ (for Lambda packaging)

# Deploy infrastructure
cd infrastructure/terraform
terraform init
terraform plan -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars

# Deploy Lambda functions
cd ../..
./scripts/deploy-lambdas.sh dev

# Deploy frontend
./scripts/deploy-frontend.sh dev
```

## Environments

| Environment | Purpose |
|-------------|---------|
| dev | Development and testing |
| staging | Pre-production validation |
| prod | Production workloads |

## Cost Estimation (Monthly)

| Service | Est. Cost |
|---------|-----------|
| Lambda | $50-200 |
| API Gateway | $20-50 |
| DynamoDB | $25-100 |
| S3 | $10-30 |
| CloudFront | $50-150 |
| OpenSearch Serverless | $200-500 |
| Bedrock (Claude) | $100-1000 |
| **Total** | **$455-2,030** |

## Current Active Deployment

As of January 2026, the active infrastructure uses (legacy stack — IDs
preserved verbatim because these are real AWS resource identifiers we
do not rename in-place; the rebrand to `humanovo-*` happens in the
new-account migration tracked by `docs/planning/REBRAND_RUNBOOK.md`):

| Component | ID | URL |
|-----------|-----|-----|
| CloudFront | EME87J10GPMET | https://d1866viaihf5o.cloudfront.net |
| S3 Frontend | genup-dev-frontend-c9e63c1c | S3 website hosting enabled |

**Note**: WAF is disabled by default to simplify deployment and prevent orphaned resources.

## Security

- All data encrypted at rest (KMS)
- TLS 1.3 for data in transit
- IAM least-privilege policies
- VPC endpoints for private access
- WAF optional (disabled by default for dev)
- Secrets in AWS Secrets Manager
