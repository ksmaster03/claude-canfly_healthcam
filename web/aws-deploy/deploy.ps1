# ============================================================================
# deploy.ps1 - Build + deploy AI Health Cam web to AWS S3 (static website)
# Pairs with Cloudflare (CNAME aicam -> S3 website endpoint, SSL Flexible).
#
# Requires: AWS CLI configured (acct 265411103824, user kosin), Node/npm.
# Usage:  powershell -ExecutionPolicy Bypass -File aws-deploy\deploy.ps1
#         add -SkipBuild to reuse the existing dist/.
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 mis-parses UTF-8).
# ============================================================================
param([switch]$SkipBuild)
# Continue (not Stop): aws CLI writes info to stderr; under Stop PS5.1 treats that
# as a terminating error. We check $LASTEXITCODE manually instead.
$ErrorActionPreference = "Continue"
function Check($msg) { if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $msg (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 } }

$Bucket  = "aicam.toptierdigital.space"   # bucket name = hostname
$Region  = "ap-southeast-7"
$WebRoot = Join-Path $PSScriptRoot ".."

Write-Host "== AI Health Cam deploy -> s3://$Bucket ($Region) ==" -ForegroundColor Cyan

# 1) build (also copies models/audio/wasm into public/)
if (-not $SkipBuild) {
  Push-Location $WebRoot
  npm run setup
  npm run build
  Pop-Location
}
$Dist = Join-Path $WebRoot "dist"
if (-not (Test-Path $Dist)) { throw "dist not found at $Dist - build first" }

# 2) create bucket if missing
aws s3api head-bucket --bucket $Bucket --region $Region 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "creating bucket..." -ForegroundColor Yellow
  aws s3api create-bucket --bucket $Bucket --region $Region `
    --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
  Check "create-bucket"
}

# 3) enable static website hosting (SPA -> index.html for all paths)
aws s3 website "s3://$Bucket" --index-document index.html --error-document index.html

# 4) allow public read (S3 website endpoint must be public)
aws s3api put-public-access-block --bucket $Bucket --public-access-block-configuration `
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

$policy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$Bucket/*"
  }]
}
"@
$polFile = Join-Path $env:TEMP "aicam-policy.json"
$policy | Out-File -FilePath $polFile -Encoding ascii
aws s3api put-bucket-policy --bucket $Bucket --policy "file://$polFile"

# 5) sync - hashed assets long cache, index.html + sw short cache
aws s3 sync $Dist "s3://$Bucket" --delete `
  --exclude "index.html" --exclude "sw.js" --exclude "registerSW.js" `
  --cache-control "public,max-age=31536000,immutable"
Check "s3 sync"
aws s3 cp (Join-Path $Dist "index.html") "s3://$Bucket/index.html" `
  --cache-control "public,max-age=300" --content-type "text/html; charset=utf-8"
if (Test-Path (Join-Path $Dist "sw.js")) {
  aws s3 cp (Join-Path $Dist "sw.js") "s3://$Bucket/sw.js" `
    --cache-control "public,max-age=0,must-revalidate" --content-type "application/javascript"
}

$Endpoint = "$Bucket.s3-website.$Region.amazonaws.com"
Write-Host ""
Write-Host "DONE. S3 website: http://$Endpoint" -ForegroundColor Green
Write-Host "Next (Cloudflare): add CNAME" -ForegroundColor Cyan
Write-Host "  aicam -> $Endpoint   (Proxied/orange, SSL = Flexible)"
Write-Host "Then open https://aicam.toptierdigital.space"
