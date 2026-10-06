"""Email service for PDFEDI.

Supports:
- "console" backend: logs the email content (development only)
- "smtp" backend: sends via SMTP (production, e.g., Resend via smtp.resend.com)

Configuration via settings:
- email_backend: "console" | "smtp"
- smtp_host, smtp_port, smtp_username, smtp_password, smtp_from
- smtp_use_tls: True for port 587 (STARTTLS)
"""
from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("pdfedi.email")
settings = get_settings()


def send_email(*, to: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send an email. Returns True on success, False on failure.
    
    In "console" mode, logs the email instead of sending.
    In "smtp" mode, sends via configured SMTP server.
    """
    if settings.email_backend == "console":
        log.info("email_console", to=to, subject=subject)
        # In console mode, log the full content for development
        print(f"\n=== EMAIL (console backend) ===\nTo: {to}\nSubject: {subject}\n\n{text_body or html_body}\n=== END EMAIL ===\n")
        return True
    
    if settings.email_backend == "smtp":
        return _send_via_smtp(to=to, subject=subject, html_body=html_body, text_body=text_body)
    
    log.warning("email_unknown_backend", backend=settings.email_backend)
    return False


def _send_via_smtp(*, to: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Send email via SMTP."""
    if not settings.smtp_host:
        log.error("email_smtp_no_host")
        return False
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from
        msg["To"] = to
        
        # Plain text version (fallback)
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        else:
            # Strip HTML tags for plain text fallback
            import re
            plain = re.sub(r"<[^>]+>", "", html_body)
            msg.attach(MIMEText(plain, "plain"))
        
        # HTML version
        msg.attach(MIMEText(html_body, "html"))
        
        # Connect and send
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
            # STARTTLS for port 587
            if settings.smtp_port == 587:
                server.starttls()
            
            if settings.smtp_username and settings.smtp_password:
                server.login(settings.smtp_username, settings.smtp_password)
            
            server.send_message(msg)
        
        log.info("email_sent", to=to, subject=subject)
        return True
        
    except Exception as e:
        log.error("email_send_failed", to=to, error=str(e)[:200])
        return False


def send_verification_email(*, to: str, verification_url: str) -> bool:
    """Send email verification link."""
    subject = "Verify your PDFEDI email"
    html_body = f"""
    <html>
    <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Welcome to PDFEDI!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="{verification_url}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email</a></p>
        <p>Or copy this link: <br><code>{verification_url}</code></p>
        <p>This link expires in 24 hours.</p>
        <p>If you didn't create a PDFEDI account, please ignore this email.</p>
    </body>
    </html>
    """
    text_body = f"Welcome to PDFEDI!\n\nPlease verify your email: {verification_url}\n\nThis link expires in 24 hours."
    return send_email(to=to, subject=subject, html_body=html_body, text_body=text_body)


def send_password_reset_email(*, to: str, reset_url: str) -> bool:
    """Send password reset link."""
    subject = "Reset your PDFEDI password"
    html_body = f"""
    <html>
    <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password:</p>
        <p><a href="{reset_url}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a></p>
        <p>Or copy this link: <br><code>{reset_url}</code></p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request a password reset, please ignore this email.</p>
    </body>
    </html>
    """
    text_body = f"Reset your PDFEDI password: {reset_url}\n\nThis link expires in 1 hour."
    return send_email(to=to, subject=subject, html_body=html_body, text_body=text_body)
