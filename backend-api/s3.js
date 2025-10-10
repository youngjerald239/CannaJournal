const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION;
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const S3_FORCE_PATH_STYLE = /^(1|true)$/i.test(process.env.S3_FORCE_PATH_STYLE || '');
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL || (S3_BUCKET && S3_REGION ? `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com` : null);

let s3Client = null;
function isEnabled(){
  return !!(S3_BUCKET && (S3_REGION || S3_ENDPOINT));
}

function client(){
  if (!isEnabled()) throw new Error('S3 not configured');
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: S3_REGION || 'us-east-1',
    endpoint: S3_ENDPOINT,
    forcePathStyle: S3_FORCE_PATH_STYLE,
    credentials: (S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } : undefined,
  });
  return s3Client;
}

async function putObject({ key, body, contentType }){
  const c = client();
  await c.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType, ACL: 'public-read' }));
  return getPublicUrl(key);
}

async function listKeys(prefix){
  const c = client();
  let ContinuationToken = undefined; const keys = [];
  do {
    const out = await c.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken }));
    (out.Contents || []).forEach(obj => { if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key); });
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

function getPublicUrl(key){
  if (S3_PUBLIC_BASE_URL) return `${S3_PUBLIC_BASE_URL}/${encodeURI(key)}`;
  // Fallback generic form
  if (S3_BUCKET && S3_REGION) return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${encodeURI(key)}`;
  return `/${key}`;
}

module.exports = { isEnabled, putObject, listKeys, getPublicUrl };
