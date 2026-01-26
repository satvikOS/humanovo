#!/bin/bash
# GenUp Infrastructure Cleanup Script
# Usage: ./scripts/cleanup-infra.sh [--dry-run] [--force]
#
# This script identifies and removes orphaned/unwanted AWS resources
# related to GenUp deployments.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Flags
DRY_RUN=false
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--dry-run] [--force]"
            exit 1
            ;;
    esac
done

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_action() { echo -e "${CYAN}[ACTION]${NC} $1"; }

# Check AWS credentials
check_aws() {
    log_info "Checking AWS credentials..."
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-east-1")
    log_success "Connected to AWS Account: $ACCOUNT_ID (Region: $REGION)"
}

# Get current Terraform-managed resources (to protect them)
get_terraform_resources() {
    log_info "Identifying Terraform-managed resources..."

    TERRAFORM_BUCKETS=()
    TERRAFORM_DISTRIBUTIONS=()

    if [ -f "$PROJECT_ROOT/infrastructure/terraform/terraform.tfstate" ]; then
        # Extract bucket names from state
        TERRAFORM_BUCKETS=($(jq -r '.resources[] | select(.type == "aws_s3_bucket") | .instances[].attributes.bucket // empty' \
            "$PROJECT_ROOT/infrastructure/terraform/terraform.tfstate" 2>/dev/null || echo ""))

        # Extract CloudFront distribution IDs from state
        TERRAFORM_DISTRIBUTIONS=($(jq -r '.resources[] | select(.type == "aws_cloudfront_distribution") | .instances[].attributes.id // empty' \
            "$PROJECT_ROOT/infrastructure/terraform/terraform.tfstate" 2>/dev/null || echo ""))
    fi

    log_info "Protected Terraform buckets: ${TERRAFORM_BUCKETS[*]:-none}"
    log_info "Protected Terraform distributions: ${TERRAFORM_DISTRIBUTIONS[*]:-none}"
}

# List all GenUp-related S3 buckets
list_genup_buckets() {
    log_info "Listing GenUp-related S3 buckets..."

    ALL_BUCKETS=$(aws s3api list-buckets --query 'Buckets[].Name' --output text)
    GENUP_BUCKETS=()

    for bucket in $ALL_BUCKETS; do
        if [[ "$bucket" == genup-* ]]; then
            GENUP_BUCKETS+=("$bucket")
        fi
    done

    echo ""
    if [ ${#GENUP_BUCKETS[@]} -eq 0 ]; then
        log_info "No GenUp-related S3 buckets found."
    else
        echo -e "${YELLOW}Found ${#GENUP_BUCKETS[@]} GenUp-related S3 bucket(s):${NC}"
        for bucket in "${GENUP_BUCKETS[@]}"; do
            # Check if protected by Terraform
            protected=""
            for tb in "${TERRAFORM_BUCKETS[@]:-}"; do
                if [ "$bucket" == "$tb" ]; then
                    protected=" ${GREEN}[PROTECTED - Terraform managed]${NC}"
                    break
                fi
            done

            # Get bucket size
            size=$(aws s3 ls "s3://${bucket}" --recursive --summarize 2>/dev/null | grep "Total Size" | awk '{print $3, $4}' || echo "empty")
            echo -e "  - $bucket ($size)$protected"
        done
    fi
    echo ""
}

# List all GenUp-related CloudFront distributions
list_genup_distributions() {
    log_info "Listing GenUp-related CloudFront distributions..."

    DISTRIBUTIONS=$(aws cloudfront list-distributions --query 'DistributionList.Items[?contains(Comment, `GenUp`) || contains(Comment, `genup`)].[Id,DomainName,Comment,Status]' --output json 2>/dev/null || echo "[]")

    echo ""
    if [ "$DISTRIBUTIONS" == "[]" ] || [ -z "$DISTRIBUTIONS" ]; then
        log_info "No GenUp-related CloudFront distributions found."
    else
        echo -e "${YELLOW}Found GenUp-related CloudFront distribution(s):${NC}"
        echo "$DISTRIBUTIONS" | jq -r '.[] | "  - ID: \(.[0]) | Domain: \(.[1]) | Comment: \(.[2]) | Status: \(.[3])"'
    fi
    echo ""
}

# Delete S3 bucket (empties first, then deletes)
delete_bucket() {
    local bucket=$1

    if $DRY_RUN; then
        log_action "[DRY-RUN] Would delete bucket: $bucket"
        return 0
    fi

    log_action "Deleting bucket: $bucket"

    # Empty the bucket first (including versions)
    log_info "Emptying bucket $bucket..."
    aws s3 rm "s3://${bucket}" --recursive 2>/dev/null || true

    # Delete versioned objects
    aws s3api list-object-versions --bucket "$bucket" --output json 2>/dev/null | \
        jq -r '.Versions[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
        while read -r args; do
            if [ -n "$args" ]; then
                eval aws s3api delete-object --bucket "$bucket" $args 2>/dev/null || true
            fi
        done

    # Delete delete markers
    aws s3api list-object-versions --bucket "$bucket" --output json 2>/dev/null | \
        jq -r '.DeleteMarkers[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
        while read -r args; do
            if [ -n "$args" ]; then
                eval aws s3api delete-object --bucket "$bucket" $args 2>/dev/null || true
            fi
        done

    # Delete the bucket
    if aws s3api delete-bucket --bucket "$bucket" 2>/dev/null; then
        log_success "Deleted bucket: $bucket"
    else
        log_error "Failed to delete bucket: $bucket"
    fi
}

# Disable and delete CloudFront distribution
delete_distribution() {
    local dist_id=$1

    if $DRY_RUN; then
        log_action "[DRY-RUN] Would delete distribution: $dist_id"
        return 0
    fi

    log_action "Deleting CloudFront distribution: $dist_id"

    # Get current config
    local config=$(aws cloudfront get-distribution-config --id "$dist_id" 2>/dev/null)
    local etag=$(echo "$config" | jq -r '.ETag')
    local enabled=$(echo "$config" | jq -r '.DistributionConfig.Enabled')

    # Disable if enabled
    if [ "$enabled" == "true" ]; then
        log_info "Disabling distribution $dist_id..."

        local new_config=$(echo "$config" | jq '.DistributionConfig.Enabled = false | .DistributionConfig')

        aws cloudfront update-distribution \
            --id "$dist_id" \
            --if-match "$etag" \
            --distribution-config "$new_config" >/dev/null

        log_info "Waiting for distribution to be disabled (this may take 10-15 minutes)..."
        aws cloudfront wait distribution-deployed --id "$dist_id" 2>/dev/null || true

        # Get new etag after disable
        etag=$(aws cloudfront get-distribution-config --id "$dist_id" --query 'ETag' --output text)
    fi

    # Delete the distribution
    if aws cloudfront delete-distribution --id "$dist_id" --if-match "$etag" 2>/dev/null; then
        log_success "Deleted distribution: $dist_id"
    else
        log_warning "Could not delete distribution $dist_id - may still be deploying. Try again later."
    fi
}

# Interactive cleanup
interactive_cleanup() {
    echo ""
    echo "========================================"
    echo "  GenUp Infrastructure Cleanup"
    echo "========================================"
    echo ""

    if $DRY_RUN; then
        log_warning "DRY-RUN MODE - No changes will be made"
        echo ""
    fi

    check_aws
    get_terraform_resources

    echo ""
    echo "========================================"
    echo "  S3 Buckets"
    echo "========================================"
    list_genup_buckets

    echo ""
    echo "========================================"
    echo "  CloudFront Distributions"
    echo "========================================"
    list_genup_distributions

    if ! $FORCE; then
        echo ""
        echo "========================================"
        echo "  Cleanup Options"
        echo "========================================"
        echo ""
        echo "Would you like to delete any resources?"
        echo "  1) Delete specific S3 bucket"
        echo "  2) Delete specific CloudFront distribution"
        echo "  3) Delete ALL non-Terraform-managed GenUp resources"
        echo "  4) Run Terraform destroy (managed cleanup)"
        echo "  5) Exit"
        echo ""
        read -p "Enter choice [1-5]: " choice

        case $choice in
            1)
                read -p "Enter bucket name to delete: " bucket_name
                if [ -n "$bucket_name" ]; then
                    delete_bucket "$bucket_name"
                fi
                ;;
            2)
                read -p "Enter CloudFront distribution ID to delete: " dist_id
                if [ -n "$dist_id" ]; then
                    delete_distribution "$dist_id"
                fi
                ;;
            3)
                log_warning "This will delete ALL GenUp resources not managed by Terraform!"
                read -p "Are you sure? (yes/no): " confirm
                if [ "$confirm" == "yes" ]; then
                    # Delete non-protected buckets
                    for bucket in "${GENUP_BUCKETS[@]:-}"; do
                        protected=false
                        for tb in "${TERRAFORM_BUCKETS[@]:-}"; do
                            if [ "$bucket" == "$tb" ]; then
                                protected=true
                                break
                            fi
                        done
                        if ! $protected; then
                            delete_bucket "$bucket"
                        fi
                    done

                    # Note: CloudFront deletion is complex, skip in batch mode
                    log_info "CloudFront distributions should be deleted individually or via Terraform."
                fi
                ;;
            4)
                log_info "Running Terraform destroy..."
                cd "$PROJECT_ROOT/infrastructure/terraform"
                terraform destroy
                ;;
            5)
                log_info "Exiting."
                exit 0
                ;;
            *)
                log_error "Invalid choice"
                exit 1
                ;;
        esac
    fi

    echo ""
    log_success "Cleanup process complete!"
}

# Run cleanup
interactive_cleanup
