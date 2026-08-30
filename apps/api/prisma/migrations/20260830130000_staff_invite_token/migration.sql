-- An outstanding staff invitation lives on the membership itself rather than in its
-- own table: one account can be invited to two hospitals, which is two memberships
-- and therefore two independent invitations, and that falls out for free here.
--
-- Only the SHA-256 of the token is stored (the rule RefreshToken already follows),
-- and both columns are cleared on acceptance, which makes a token single-use by
-- construction rather than by a flag someone has to remember to check.

-- AlterTable
ALTER TABLE "HospitalStaff" ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HospitalStaff_inviteTokenHash_key" ON "HospitalStaff"("inviteTokenHash");
