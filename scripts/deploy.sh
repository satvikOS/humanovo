#!/bin/bash
# GenUp Full Deployment Script
# Usage: ./scripts/deploy.sh <environment> [component]
# Components: all, infrastructure, lambdas, frontend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check required tools
check_requirements() {
    log_info "Checking requirements..."

    local missing=()

    command -v aws >/dev/null 2>&1 || missing+=("aws")
    command -v terraform >/dev/null 2>&1 || missing+=("terraform")
    command -v python3 >/dev/null 2>&1 || missing+=("python3")
    command -v node >/dev/null 2>&1 || missing+=("node")
    command -v npm >/dev/null 2>&1 || missing+=("npm")
    command -v zip >/dev/null 2>&1 || missing+=("zip")

    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi

    log_success "All requirements met"
}

# Deploy infrastructure with Terraform
deploy_infrastructure() {
    local env=$1
    log_info "Deploying infrastructure for environment: $env"

    cd "$PROJECT_ROOT/infrastructure/terraform"

    # Initialize Terraform
    log_info "Initializing Terraform..."
    terraform init -upgrade

    # Plan
    log_info "Planning infrastructure changes..."
    terraform plan -var-file="environments/${env}.tfvars" -out=tfplan

    # Apply
    log_info "Applying infrastructure changes..."
    terraform apply tfplan

    # Get outputs
    log_info "Fetching outputs..."
    terraform output -json > "$PROJECT_ROOT/.terraform-outputs-${env}.json"

    rm -f tfplan
    log_success "Infrastructure deployed successfully"
}

# Build and deploy Lambda functions
deploy_lambdas() {
    local env=$1
    log_info "Deploying Lambda functions for environment: $env"

    cd "$PROJECT_ROOT"

    # Load Terraform outputs
    local outputs_file=".terraform-outputs-${env}.json"
    if [ ! -f "$outputs_file" ]; then
        log_warning "Terraform outputs not found. Running terraform output..."
        cd infrastructure/terraform
        terraform output -json > "$PROJECT_ROOT/$outputs_file"
        cd "$PROJECT_ROOT"
    fi

    local artifacts_bucket=$(jq -r '.data_bucket_name.value // empty' "$outputs_file")
    if [ -z "$artifacts_bucket" ]; then
        # Fallback: get from terraform
        cd infrastructure/terraform
        artifacts_bucket=$(terraform output -raw artifacts_bucket_name 2>/dev/null || echo "")
        cd "$PROJECT_ROOT"
    fi

    if [ -z "$artifacts_bucket" ]; then
        log_error "Could not determine artifacts bucket. Deploy infrastructure first."
        exit 1
    fi

    log_info "Using artifacts bucket: $artifacts_bucket"

    # Create build directory
    local build_dir="$PROJECT_ROOT/.build/lambda"
    rm -rf "$build_dir"
    mkdir -p "$build_dir"

    # Build Lambda layer with dependencies
    log_info "Building Lambda layer..."
    local layer_dir="$build_dir/layer/python"
    mkdir -p "$layer_dir"

    pip install \
        aws-lambda-powertools \
        boto3 \
        pydantic \
        httpx \
        "openai>=1.12.0,<2.0" \
        -t "$layer_dir" \
        --quiet

    cd "$build_dir/layer"
    zip -r9 ../dependencies.zip . >/dev/null
    cd "$PROJECT_ROOT"

    # Upload layer
    log_info "Uploading Lambda layer..."
    aws s3 cp "$build_dir/dependencies.zip" "s3://${artifacts_bucket}/lambda-layers/dependencies.zip"

    # Build SciPy layer (for simulation functions)
    log_info "Building SciPy layer..."
    local scipy_layer_dir="$build_dir/scipy-layer/python"
    mkdir -p "$scipy_layer_dir"

    pip install \
        numpy \
        scipy \
        -t "$scipy_layer_dir" \
        --quiet

    cd "$build_dir/scipy-layer"
    zip -r9 ../scipy.zip . >/dev/null
    cd "$PROJECT_ROOT"

    aws s3 cp "$build_dir/scipy.zip" "s3://${artifacts_bucket}/lambda-layers/scipy.zip"

    # Build each Lambda function
    local lambda_handlers=(
        "api_core"
        "projects"
        "hypotheses"
        "evidence"
        "knowledge"
        "hypothesis_generation"
        "agent_orchestrator"
        "search_agent"
        "embeddings"
        "simulation"
        "simulation_worker"
        "ingestion"
        "pubmed_fetcher"
        "clinical_trials_fetcher"
    )

    for handler in "${lambda_handlers[@]}"; do
        log_info "Building Lambda function: $handler"

        local func_dir="$build_dir/functions/$handler"
        mkdir -p "$func_dir"

        # Copy handler code
        if [ -f "backend/lambda/handlers/${handler}.py" ]; then
            cp "backend/lambda/handlers/${handler}.py" "$func_dir/"
        else
            # Create placeholder handler if not exists
            cat > "$func_dir/${handler}.py" << 'HANDLER_EOF'
import json
from aws_lambda_powertools import Logger
logger = Logger()

def handler(event, context):
    logger.info("Handler invoked", extra={"event": event})
    return {
        "statusCode": 200,
        "body": json.dumps({"message": "OK", "handler": "${handler}"})
    }
HANDLER_EOF
        fi

        # Copy shared modules
        if [ -d "backend/lambda/shared" ]; then
            cp -r "backend/lambda/shared"/* "$func_dir/" 2>/dev/null || true
        fi

        # Bundle extra dependencies for agent_orchestrator
        if [ "$handler" = "agent_orchestrator" ]; then
            log_info "  Installing openai + reportlab into $handler function zip..."
            pip install "openai>=1.12.0,<2.0" "reportlab>=4.0,<5.0" -t "$func_dir/" --quiet 2>/dev/null
        fi

        # Create zip
        cd "$func_dir"
        zip -r9 "../${handler}.zip" . >/dev/null
        cd "$PROJECT_ROOT"

        # Upload to S3
        aws s3 cp "$build_dir/functions/${handler}.zip" "s3://${artifacts_bucket}/lambda-functions/${handler}.zip"
    done

    # Update Lambda functions
    log_info "Updating Lambda function code..."
    local name_prefix="genup-${env}"

    for handler in "${lambda_handlers[@]}"; do
        local func_name="${name_prefix}-${handler}"

        # Check if function exists
        if aws lambda get-function --function-name "$func_name" >/dev/null 2>&1; then
            log_info "Updating function: $func_name"
            aws lambda update-function-code \
                --function-name "$func_name" \
                --s3-bucket "$artifacts_bucket" \
                --s3-key "lambda-functions/${handler}.zip" \
                --publish \
                >/dev/null
        else
            log_warning "Function $func_name does not exist (will be created by Terraform)"
        fi
    done

    # Cleanup
    rm -rf "$build_dir"

    log_success "Lambda functions deployed successfully"
}

# Build and deploy frontend
deploy_frontend() {
    local env=$1
    log_info "Deploying frontend for environment: $env"

    cd "$PROJECT_ROOT/frontend"

    # Install dependencies
    log_info "Installing npm dependencies..."
    npm ci --silent

    # Build
    log_info "Building frontend..."
    VITE_API_URL="" npm run build

    # Get bucket name from Terraform outputs
    cd "$PROJECT_ROOT"
    local outputs_file=".terraform-outputs-${env}.json"

    if [ ! -f "$outputs_file" ]; then
        cd infrastructure/terraform
        terraform output -json > "$PROJECT_ROOT/$outputs_file"
        cd "$PROJECT_ROOT"
    fi

    local frontend_bucket=$(jq -r '.frontend_bucket_name.value // empty' "$outputs_file")
    local distribution_id=$(jq -r '.cloudfront_distribution_id.value // empty' "$outputs_file")

    if [ -z "$frontend_bucket" ]; then
        cd infrastructure/terraform
        frontend_bucket=$(terraform output -raw frontend_bucket_name 2>/dev/null || echo "")
        distribution_id=$(terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
        cd "$PROJECT_ROOT"
    fi

    if [ -z "$frontend_bucket" ]; then
        log_error "Could not determine frontend bucket. Deploy infrastructure first."
        exit 1
    fi

    log_info "Deploying to S3 bucket: $frontend_bucket"

    # Sync to S3
    aws s3 sync frontend/dist "s3://${frontend_bucket}" \
        --delete \
        --cache-control "public, max-age=31536000" \
        --exclude "index.html" \
        --exclude "*.json"

    # Upload index.html with no-cache
    aws s3 cp frontend/dist/index.html "s3://${frontend_bucket}/index.html" \
        --cache-control "no-cache, no-store, must-revalidate"

    # Invalidate CloudFront cache
    if [ -n "$distribution_id" ]; then
        log_info "Invalidating CloudFront cache..."
        aws cloudfront create-invalidation \
            --distribution-id "$distribution_id" \
            --paths "/*" \
            >/dev/null

        log_info "CloudFront invalidation created"
    fi

    log_success "Frontend deployed successfully"
}

# Main
main() {
    local env="${1:-dev}"
    local component="${2:-all}"

    echo ""
    echo "========================================"
    echo "  GenUp Deployment Script"
    echo "  Environment: $env"
    echo "  Component: $component"
    echo "========================================"
    echo ""

    check_requirements

    case "$component" in
        all)
            deploy_infrastructure "$env"
            deploy_lambdas "$env"
            deploy_frontend "$env"
            ;;
        infrastructure|infra)
            deploy_infrastructure "$env"
            ;;
        lambdas|lambda)
            deploy_lambdas "$env"
            ;;
        frontend|front)
            deploy_frontend "$env"
            ;;
        *)
            log_error "Unknown component: $component"
            echo "Usage: $0 <environment> [all|infrastructure|lambdas|frontend]"
            exit 1
            ;;
    esac

    echo ""
    log_success "Deployment complete!"

    # Print URLs
    if [ -f "$PROJECT_ROOT/.terraform-outputs-${env}.json" ]; then
        local cloudfront_url=$(jq -r '.cloudfront_domain_name.value // empty' "$PROJECT_ROOT/.terraform-outputs-${env}.json")
        local api_url=$(jq -r '.api_gateway_stage_url.value // empty' "$PROJECT_ROOT/.terraform-outputs-${env}.json")

        echo ""
        echo "========================================"
        echo "  Deployment URLs"
        echo "========================================"
        [ -n "$cloudfront_url" ] && echo "  Frontend: https://$cloudfront_url"
        [ -n "$api_url" ] && echo "  API:      $api_url"
        echo "========================================"
    fi
}

main "$@"
