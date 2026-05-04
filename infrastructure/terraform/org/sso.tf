# IAM Identity Center (formerly AWS SSO) — replaces individual IAM
# users for engineers. Required for clean SOC 2 evidence.
#
# Identity Center has a quirk: the *instance* itself is created via
# the AWS console once per Org (Terraform can't enable the service).
# This file assumes the instance already exists and references it via
# a data source. Phase 2 of the bootstrap workflow surfaces a console
# link in its output to do the one-time enable.

data "aws_ssoadmin_instances" "this" {
  count = local.enable_sso ? 1 : 0
}

locals {
  sso_instance_arn  = local.enable_sso && length(data.aws_ssoadmin_instances.this) > 0 ? data.aws_ssoadmin_instances.this[0].arns[0] : null
  identity_store_id = local.enable_sso && length(data.aws_ssoadmin_instances.this) > 0 ? data.aws_ssoadmin_instances.this[0].identity_store_ids[0] : null
}

# Permission sets — bind users/groups to one of these per account.
# Naming reflects the principal-of-least-privilege defaults.
resource "aws_ssoadmin_permission_set" "admin" {
  count = local.enable_sso ? 1 : 0

  name             = "${var.brand}-Admin"
  description      = "Full administrative access (break-glass; should be used only by 1-2 humans)."
  instance_arn     = local.sso_instance_arn
  session_duration = "PT4H"
}

resource "aws_ssoadmin_permission_set" "engineer" {
  count = local.enable_sso ? 1 : 0

  name             = "${var.brand}-Engineer"
  description      = "Day-to-day engineering: read-write on app-level resources, read-only on IAM/Org."
  instance_arn     = local.sso_instance_arn
  session_duration = "PT8H"
}

resource "aws_ssoadmin_permission_set" "read_only" {
  count = local.enable_sso ? 1 : 0

  name             = "${var.brand}-ReadOnly"
  description      = "Read-only auditor / observer access."
  instance_arn     = local.sso_instance_arn
  session_duration = "PT8H"
}

resource "aws_ssoadmin_managed_policy_attachment" "admin" {
  count = local.enable_sso ? 1 : 0

  instance_arn       = local.sso_instance_arn
  managed_policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
  permission_set_arn = aws_ssoadmin_permission_set.admin[0].arn
}

resource "aws_ssoadmin_managed_policy_attachment" "engineer" {
  count = local.enable_sso ? 1 : 0

  instance_arn       = local.sso_instance_arn
  managed_policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
  permission_set_arn = aws_ssoadmin_permission_set.engineer[0].arn
}

resource "aws_ssoadmin_managed_policy_attachment" "read_only" {
  count = local.enable_sso ? 1 : 0

  instance_arn       = local.sso_instance_arn
  managed_policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
  permission_set_arn = aws_ssoadmin_permission_set.read_only[0].arn
}
