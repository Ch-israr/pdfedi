"""Model registry — import every model so Alembic sees the full schema."""
from app.db.base import Base  # noqa: F401
from app.db.models.admin import AdminAuditLog, ApiKey, FeatureFlag, SystemSetting  # noqa: F401
from app.db.models.auth import (  # noqa: F401
    AuthSession,
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
)
from app.db.models.enums import (  # noqa: F401
    AccountStatus,
    FileUploadStatus,
    JobStatus,
    PlanCategory,
    StorageClass,
    SubscriptionStatus,
)
from app.db.models.files import File, JobInput, JobOutput, ProcessingJob, UsageRecord  # noqa: F401
from app.db.models.subscriptions import Entitlement, Subscription, SubscriptionPlan  # noqa: F401
from app.db.models.users import Permission, Role, RolePermission, User, UserProfile, UserRole  # noqa: F401

__all__ = ["Base"]
