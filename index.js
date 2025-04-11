const CKMySQL = require('./utils/ck-mysql').CKMySQL;
const CKUtils = require('./utils/ck-utils').CKUtils;

const { google } = require('googleapis');

const process = require('process');
// const fs = require('fs');
// const path = require('path');

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
const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

let handler = async (event) => {
  const results = [];

  const getSubfolders = async (parentId) => {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });
    return res.data.files;
  };

  const getImageFilesInFolder = async (folderId) => {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id, name, mimeType)',
    });
    return res.data.files;
  };

  const processImageFile = async (file, category) => {
    const { id: fileId, mimeType } = file;

    // Check if file is already processed
    const existing = await connection.query(
      'SELECT id FROM random_meme WHERE id = ? LIMIT 1',
      [fileId]
    );
    if (existing.length > 0) {
      console.log(`Already processed: ${fileId}`);
      return;
    }
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(response.data);

    let extension = mimeType.split('/')[1];
    if (extension === 'jpeg') extension = 'jpg';

    const s3Key = `random-memes/${category}/${fileId}.${extension}`;
    // const directory = path.dirname(s3Key);

    // if (!fs.existsSync(directory)) {
    //   fs.mkdirSync(directory, { recursive: true });
    // }

    // if (!CKUtils.isLambda()) fs.writeFileSync(`${s3Key}`, buffer);

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

    await connection.query(
      'INSERT IGNORE INTO random_meme (id, path, category) VALUES (?, ?, ?)',
      [fileId, s3Key, category]
    );

    results.push({ id: fileId, s3Key, category });
  };

  try {
    // 1. Process root folder images first
    const rootImages = await getImageFilesInFolder(rootFolderId);
    for (const file of rootImages) {
      await processImageFile(file, 'root');
    }

    // 2. Process each subfolder as category
    const folders = await getSubfolders(rootFolderId);

    for (const folder of folders) {
      const { id: folderId, name: category } = folder;
      const imageFiles = await getImageFilesInFolder(folderId);

      for (const file of imageFiles) {
        await processImageFile(file, category);
      }
    }

    connection.close();
    console.log('db closed');

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, processed: results }),
    };

  } catch (err) {
    console.error("Lambda error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};

if (CKUtils.isLambda()) {
  exports.handler = handler;
} else {
  handler();
}