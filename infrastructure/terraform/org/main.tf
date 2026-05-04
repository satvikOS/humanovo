# AWS Organization shell. Creating an Organization is *hard* to fully
# reverse — closing it requires removing every member account first
# (each requires a 90-day cooldown via AWS Support).
#
# Phase 1 of bootstrap-org-apply.yml provisions only this file's
# resources. Phase 2 adds sso.tf; phase 3 adds controltower.tf +
# guardduty.tf + securityhub.tf.

resource "aws_organizations_organization" "this" {
  count = local.enable_org ? 1 : 0

  feature_set = "ALL"

  aws_service_access_principals = [
    "controltower.amazonaws.com",
    "guardduty.amazonaws.com",
    "securityhub.amazonaws.com",
    "sso.amazonaws.com",
    "config.amazonaws.com",
    "cloudtrail.amazonaws.com",
  ]

  enabled_policy_types = [
    "SERVICE_CONTROL_POLICY",
    "TAG_POLICY",
  ]
}

# One organizational unit per environment, parented to the root.
# OUs are the unit of policy attachment — SCPs hang off them in phase 3.
resource "aws_organizations_organizational_unit" "env" {
  for_each = local.enable_org ? local.account_specs : {}

  name      = each.value.name
  parent_id = aws_organizations_organization.this[0].roots[0].id
}

# Member accounts. Each account's root identity gets a unique email via
# plus-addressing on the configured domain. The email is used by AWS
# only for billing/support — not exposed in normal operation.
resource "aws_organizations_account" "member" {
  for_each = local.enable_org ? local.account_specs : {}

  name      = each.value.name
  email     = "${var.org_email_prefix}+${each.key}@${var.org_email_domain}"
  parent_id = aws_organizations_organizational_unit.env[each.key].id

  # Prevent accidental destruction. Removing accounts requires manual
  # intervention via AWS Support — Terraform should NEVER do it.
  lifecycle {
    prevent_destroy       = true
    ignore_changes        = [role_name]
  }

  # The cross-account assume-role created by Organizations is named
  # `OrganizationAccountAccessRole`. Leaving the default lets the
  # management account assume into each member without extra wiring.
}
