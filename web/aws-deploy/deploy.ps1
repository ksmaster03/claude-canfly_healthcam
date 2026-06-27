# ============================================================================
# deploy.ps1 — Build + deploy AI Health Cam web → AWS S3 (static website)
# ใช้คู่กับ Cloudflare (CNAME aicam → S3 website endpoint, SSL Flexible)
#
# ต้องมี: AWS CLI ตั้งค่าแล้ว (acct 265411103824, user kosin), Node/npm
# วิธีใช้:  powershell -ExecutionPolicy Bypass -File aws-deploy\deploy.ps1
#          เพิ่ม -SkipBuild ถ้าจะไม่ build ใหม่
# ============================================================================
param([switch]$SkipBuild)
$ErrorActionPreference = "Stop"

$Bucket = "aicam.toptierdigital.space"   # ตั้งชื่อ bucket = hostname
$Region = "ap-southeast-7"
$WebRoot = Join-Path $PSScriptRoot ".."

Write-Host "== AI Health Cam deploy → s3://$Bucket ($Region) ==" -ForegroundColor Cyan

# 1) build (รวม copy โมเดล/เสียง/wasm เข้า public ก่อน)
if (-not $SkipBuild) {
  Push-Location $WebRoot
  npm run setup
  npm run build
  Pop-Location
}
$Dist = Join-Path $WebRoot "dist"
if (-not (Test-Path $Dist)) { throw "ไม่พบ $Dist — build ก่อน" }

# 2) สร้าง bucket ถ้ายังไม่มี
aws s3api head-bucket --bucket $Bucket --region $Region 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "สร้าง bucket..." -ForegroundColor Yellow
  aws s3api create-bucket --bucket $Bucket --region $Region `
    --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
}

# 3) เปิด static website hosting (SPA → index.html รับทุก path)
aws s3 website "s3://$Bucket" --index-document index.html --error-document index.html

# 4) เปิด public read (S3 website endpoint ต้อง public)
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

# 5) sync ไฟล์ — assets ที่มี hash cache ยาว, index.html cache สั้น
aws s3 sync $Dist "s3://$Bucket" --delete `
  --exclude "index.html" --cache-control "public,max-age=31536000,immutable"
aws s3 cp (Join-Path $Dist "index.html") "s3://$Bucket/index.html" `
  --cache-control "public,max-age=300" --content-type "text/html; charset=utf-8"

$Endpoint = "$Bucket.s3-website.$Region.amazonaws.com"
Write-Host ""
Write-Host "เสร็จ! S3 website: http://$Endpoint" -ForegroundColor Green
Write-Host "ขั้นต่อไป (Cloudflare): เพิ่ม CNAME" -ForegroundColor Cyan
Write-Host "  aicam  →  $Endpoint   (Proxied/ส้ม, SSL = Flexible)"
Write-Host "จากนั้นเปิด https://aicam.toptierdigital.space"
