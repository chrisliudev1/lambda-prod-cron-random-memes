// zip -r function.zip .

// CREATE TABLE random_meme (
//   id VARCHAR(255) PRIMARY KEY,
//   path VARCHAR(512) NOT NULL,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );

const CKMySQL = require('./utils/ck-mysql').CKMySQL;
const CKUtils = require('./utils/ck-utils').CKUtils;

const { google } = require('googleapis');

const process = require('process');
const fs = require('fs');

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({ region: 'us-east-1' });
const s3Bucket = 'ebaumsworld.stage';

let dbConfig = {
  'database': 'cms'
};

if (!CKUtils.isLambda()) {
  require('dotenv').config();
  dbConfig['port'] = process.env.db_port;
}

dbConfig['host'] = process.env.db_host;
dbConfig['user'] = process.env.db_user;
dbConfig['password'] = process.env.db_password;

const connection = new CKMySQL(dbConfig);

const getDriveClient = () => {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString()
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
};

const drive = getDriveClient();


exports.handler = async (event) => {

  try {
    const { fileIds } = JSON.parse(event.body);
    const results = [];

    for (const fileId of fileIds) {
      // Skip if already saved
      const [existing] = await connection.execute(
        'SELECT id FROM random_meme WHERE id = ? LIMIT 1',
        [fileId]
      );
      if (existing.length > 0) {
        console.log(`Already exists: ${fileId}`);
        continue;
      }

      // Get file info
      const meta = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType',
      });

      const { mimeType } = meta.data;
      if (!mimeType.startsWith('image/')) {
        console.log(`Skipping non-image: ${fileId}`);
        continue;
      }

      const file = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(file.data);

      let extension = mimeType.split('/')[1];
      if (extension === 'jpeg') extension = 'jpg';

      const s3Key = `random-memes/${fileId}.${extension}`;

      if (!CKUtils.isLambda()) fs.writeFileSync(`${s3Key}`, buffer);

      // Upload to S3
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: mimeType,
          ACL: 'public-read',
        })
      )
      .then(() => {
          console.log(`${s3Key} Sent to S3`);
      });   

      // Save just the S3 key in DB
      await connection.execute(
        'INSERT INTO random_meme (id, path) VALUES (?, ?)',
        [fileId, s3Key]
      );

      results.push({ id: fileId, s3Key });
    }

    db.close();
    console.log('db closed');

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, images: results }),
    };

  } catch (err) {
    console.error("Lambda error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
