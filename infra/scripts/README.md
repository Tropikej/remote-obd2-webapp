This directory holds deployment, maintenance, and local validation scripts.
Add automation here during the ops plan.

Local validation scripts:
- `infra/scripts/test-rate-limit-signup.js` exercises the signup rate limiter.
- `infra/scripts/test-rate-limit-password-reset.js` exercises the password reset rate limiter.
- `infra/scripts/test-control-plane.js` exercises agent registration, device reporting, dongle inventory, and CAN config apply.
