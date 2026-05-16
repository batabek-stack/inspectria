# Email Password Reset Follow-Up

When email delivery is enabled, update the password reset flow to send reset links by email instead of exposing manual links in the admin UI.

Implementation notes:
- Keep using `password_reset_tokens`; it already stores only token hashes.
- Add an email address field for users if one is not available yet.
- Update `POST /api/users/:id/password-reset-link` or add a public forgot-password endpoint to call the mail provider.
- Keep the reset token short-lived and single-use.
- Continue deleting active sessions after a password reset.
