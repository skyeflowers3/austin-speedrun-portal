#!/usr/bin/env bash
# Deploy the built parent portal (dist/) to an AWS S3 website bucket.
#
# Usage:
#   npm run build && ./deploy.sh
#   BUCKET=my-bucket REGION=us-east-1 ./deploy.sh
#
# Requires: awscli v2 with S3 permissions (e.g. AWS_PROFILE=sbsandbox).
set -euo pipefail

BUCKET="${BUCKET:-austin-speedrun-portal-site}"
REGION="${REGION:-us-east-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"

if [ ! -f "$DIST/index.html" ]; then
  echo "No build found. Run: npm run build" >&2
  exit 1
fi

echo "==> Deploying '$DIST' to s3://$BUCKET ($REGION)"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "==> Creating bucket $BUCKET"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
fi

echo "==> Configuring public read"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"PublicReadGetObject\",
    \"Effect\": \"Allow\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
  }]
}"

echo "==> Enabling static website hosting (SPA)"
aws s3 website "s3://$BUCKET/" --index-document index.html --error-document index.html

echo "==> Uploading hashed assets (long cache)"
aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" \
  --delete --cache-control "public,max-age=31536000,immutable"

echo "==> Uploading app shell (no cache)"
aws s3 sync "$DIST" "s3://$BUCKET" \
  --delete --exclude "assets/*" --cache-control "no-cache"

if [ "$REGION" = "us-east-1" ]; then
  URL="http://$BUCKET.s3-website-us-east-1.amazonaws.com"
else
  URL="http://$BUCKET.s3-website.$REGION.amazonaws.com"
fi
echo ""
echo "==> Deployed: $URL"
