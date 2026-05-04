terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Backend is configured by the workflow at init time so we can switch
  # from the legacy `genup-terraform-state` bucket to the new
  # `humanovo-terraform-state` once the security account is up.
  backend "s3" {}
}
