# GuardDuty + Security Hub aggregation to the security account.
#
# Phase 3 (`3-org-sso-and-guardrails`) only. GuardDuty enabled in
# every account; findings auto-aggregate to the delegated administrator
# (the security account). Security Hub follows the same pattern, with
# the Foundational Security Best Practices standard enabled by default.

# Enable GuardDuty in the management account first; the rest get it
# via Org-wide auto-enable below.
resource "aws_guardduty_detector" "management" {
  count  = local.enable_guardrails ? 1 : 0
  enable = true
}

# Delegate GuardDuty admin to the security account.
resource "aws_guardduty_organization_admin_account" "security" {
  count = local.enable_guardrails ? 1 : 0

  admin_account_id = aws_organizations_account.member["security"].id

  depends_on = [aws_guardduty_detector.management]
}

# Once delegated, GuardDuty auto-enables in each member account.
# `auto_enable_organization_members = ALL` means new accounts that join
# the Org also get GuardDuty automatically.
resource "aws_guardduty_organization_configuration" "this" {
  count = local.enable_guardrails ? 1 : 0

  auto_enable_organization_members = "ALL"
  detector_id                      = aws_guardduty_detector.management[0].id

  datasources {
    s3_logs {
      auto_enable = true
    }
    kubernetes {
      audit_logs {
        enable = true
      }
    }
    malware_protection {
      scan_ec2_instance_with_findings {
        ebs_volumes {
          auto_enable = true
        }
      }
    }
  }

  depends_on = [aws_guardduty_organization_admin_account.security]
}
