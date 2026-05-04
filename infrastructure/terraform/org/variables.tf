variable "region" {
  description = "Default AWS region for organization-level resources."
  type        = string
  default     = "us-east-1"
}

variable "brand" {
  description = "Resource-name prefix. Locked to humanovo for v1; intentionally not parameterized further."
  type        = string
  default     = "humanovo"
}

variable "org_email_prefix" {
  description = <<-EOT
    Email prefix for new account root identities. Each member account
    gets `${var.org_email_prefix}+<account>@<domain>`. Use a domain you
    control with plus-addressing enabled (Google Workspace + Fastmail
    both support it).
  EOT
  type    = string
}

variable "org_email_domain" {
  description = "Domain portion of the account email addresses (e.g. humanovo.net)."
  type        = string
}

variable "sso_admin_email" {
  description = "Email of the human admin who'll assume the AWS Identity Center root permission set."
  type        = string
}

variable "phase" {
  description = <<-EOT
    Which phase of the bootstrap to apply. Set by the workflow's
    workflow_dispatch input. Values: "0-plan-only", "1-org-only",
    "2-org-and-sso", "3-org-sso-and-guardrails".
  EOT
  type    = string
  default = "0-plan-only"

  validation {
    condition     = contains(["0-plan-only", "1-org-only", "2-org-and-sso", "3-org-sso-and-guardrails"], var.phase)
    error_message = "phase must be one of: 0-plan-only, 1-org-only, 2-org-and-sso, 3-org-sso-and-guardrails"
  }
}

# Phase gates derived from the above. Keeps resource `count` blocks
# readable and consistent across files.
locals {
  enable_org         = contains(["1-org-only", "2-org-and-sso", "3-org-sso-and-guardrails"], var.phase)
  enable_sso         = contains(["2-org-and-sso", "3-org-sso-and-guardrails"], var.phase)
  enable_guardrails  = var.phase == "3-org-sso-and-guardrails"

  account_specs = {
    prod     = { name = "${var.brand}-prod" }
    staging  = { name = "${var.brand}-staging" }
    dev      = { name = "${var.brand}-dev" }
    security = { name = "${var.brand}-security" }
  }
}
