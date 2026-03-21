-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT;

-- CreateTable
CREATE TABLE "otp_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_tokens_email_purpose_idx" ON "otp_tokens"("email", "purpose");
