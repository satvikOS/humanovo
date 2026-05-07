# Admin-only lockdown for the CloudFront URL.
#
# End users get the native desktop app. The CloudFront URL exists so
# the founder can preview UI changes from a browser. To prevent
# random crawlers / users from reaching it (and to fail closed if the
# URL leaks), CloudFront drops requests that don't carry an
# `X-Admin-Secret: <ADMIN_HEADER_SECRET>` header.
#
# The check happens at the CloudFront edge via a viewer-request
# function — fast (sub-ms), free at our scale (first 2M
# function invocations/mo are included), and avoids a full WAF setup
# for a single-tenant admin gate.
#
# To access from a browser: install a header-injection extension
# (ModHeader, Requestly, etc.) and set
#   X-Admin-Secret: <value of admin_header_secret variable>
# Then `https://d1l1516144ax30.cloudfront.net/` loads normally.
#
# To rotate the secret: change `admin_header_secret`, terraform apply.
# CloudFront propagation is ~3 min after deploy.
#
# Future: replace with an actual SSO flow (Cognito user pool +
# Lambda@Edge auth) once we have more than one admin. For now a
# shared header is the right cost/leverage tradeoff.

variable "admin_header_secret" {
  description = "Value the X-Admin-Secret header must carry to reach the frontend. Treat as a secret — rotate on suspected leak."
  type        = string
  sensitive   = true
  # A reasonable default for first apply. Override via:
  #   terraform apply -var "admin_header_secret=<long-random-string>"
  # OR set TF_VAR_admin_header_secret in the workflow env.
  default = "humanovo-admin-rotate-me-asap"
}

resource "aws_cloudfront_function" "admin_gate" {
  name    = "${var.name_prefix}-${var.environment}-admin-gate"
  runtime = "cloudfront-js-2.0"
  comment = "Reject viewer requests missing X-Admin-Secret. Admin-only lockdown for the testing-surface CloudFront URL."
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      var headers = request.headers;
      var expected = "${var.admin_header_secret}";
      var got = headers["x-admin-secret"] && headers["x-admin-secret"].value;
      if (got !== expected) {
        return {
          statusCode: 403,
          statusDescription: "Forbidden",
          headers: {
            "content-type": { value: "text/plain" },
            "cache-control": { value: "no-store" }
          },
          body: "humanovo - admin only. End users: download the native desktop app."
        };
      }
      return request;
    }
  JS
}

# Re-bind the gate function to the existing CloudFront distribution
# from main.tf. We use a `lifecycle.replace_triggered_by` block so
# changing the function code triggers a distribution update — without
# this, edits to the gate code would land on the function but not be
# associated with the distribution until something else changed.
#
# NOTE: this requires editing aws_cloudfront_distribution.frontend in
# main.tf to wire in the function. See main.tf — adding it inline
# instead of via this side file would have caused a circular variable
# dependency between admin_header_secret and the distribution. Keeping
# the function definition here is fine because Terraform resolves
# the cross-file references at plan time.

output "admin_header_secret_hint" {
  description = "How to reach the frontend in a browser"
  value       = "Set request header: X-Admin-Secret: <admin_header_secret>"
}
