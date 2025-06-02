const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ExcelJS = require("exceljs");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "85mb" }));

const s3 = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = "onboardingformbucket";

app.post("/submit", async (req, res) => {

  try {
    const { businessData, clientData, kycData, financialFiles } = req.body;
    const superFolder = `${businessData.businessName}${Date.now()}`;

    const uploadFileToS3 = async (file, folder, prefix = "") => {

      try {
        const buffer = Buffer.from(file.data, "base64");
        const fileName = `${prefix}_${Date.now()}_${file.name}`;

        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${superFolder}/${folder}/${fileName}`,
          Body: buffer,
          ContentType: file.type,
        });

        await s3.send(command);
        console.log(`Uploaded file: ${fileName} to folder: ${folder}`);
      } catch (err) {
        console.error(`Failed to upload file ${file.name}:`, err);
        throw err;
      }
    };

    const businessInfo = []
     for (const key in businessData) {
      if (businessData[key]?.data) {
        await uploadFileToS3(businessData[key], "BusinessDetails", key);
        businessInfo.push({ label: key, fileName: businessData[key].name });
      }
    }
    // Upload and record KYC Files
    const kycInfo = [];
    for (const key in kycData) {
      if (kycData[key]?.data) {
        await uploadFileToS3(kycData[key], "KYCDetails", key);
        kycInfo.push({ label: key, fileName: kycData[key].name });
      }
    }

    // Upload and record Financial Files
    const financialInfo = [];
    for (const key in financialFiles) {
      const fileArray = financialFiles[key];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        if (file?.data) {
          await uploadFileToS3(file, "FinancialDetails", `${key}_${i}`);
          financialInfo.push({ label: key, index: i, fileName: file.name });
        }
      }
    }

    // Upload and record Client Files
    for (let i = 0; i < clientData.length; i++) {
      const client = clientData[i];
      const uploadedFileNames = [];
      console.log("Client Data:", client);
      // let { payrollListUpload, workOrderUpload, invoiceUpload } = client;
      if (client?.payrollListUpload) {
        await uploadFileToS3(client.payrollListUpload, "ClientDetails", `${client.clientName}_payroll`);
        uploadedFileNames.push(client.payrollListUpload.name);
      }
      if (client?.workOrderUpload) {
        await uploadFileToS3(client.workOrderUpload, "ClientDetails", `${client.clientName}_workorder`);
        uploadedFileNames.push(client.workOrderUpload.name);
      }
      if (client?.invoiceUpload) {
        await uploadFileToS3(client.invoiceUpload, "ClientDetails", `${client.clientName}_invoice`);
        uploadedFileNames.push(client.invoiceUpload.name);
      }
    }

    // Save BusinessDetails Excel
    const businessSheet = new ExcelJS.Workbook();
    const businessWs = businessSheet.addWorksheet("Business Details");
    businessWs.addRow(["Business Name", "Entity", "Industry", "Business Age","Registered Address", "Head Office Address"]);
    businessWs.addRow([businessData.businessName, businessData.entity, businessData.industry, businessData.businessAge, businessData.registeredOffice, businessData.headOffice]);
    const businessBuffer = await businessSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/BusinessDetails/Business_Details.xlsx`,
      Body: businessBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Save KYC Excel
    const kycSheet = new ExcelJS.Workbook();
    const kycWs = kycSheet.addWorksheet("KYC Details");
    kycWs.addRow(["Document", "File Name"]);
    kycInfo.forEach(item => kycWs.addRow([item.label, item.fileName]));
    const kycBuffer = await kycSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/KYCDetails/KYC_Details.xlsx`,
      Body: kycBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Save Financial Excel
    const financialSheet = new ExcelJS.Workbook();
    const financialWs = financialSheet.addWorksheet("Financial Details");
    financialWs.addRow(["File Type", "File Name"]);
    financialInfo.forEach(item => financialWs.addRow([item.label, item.fileName]));
    const financialBuffer = await financialSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/FinancialDetails/Financial_Details.xlsx`,
      Body: financialBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Save Client Excel
    const clientSheet = new ExcelJS.Workbook();
    console.log("::138Client Data:", clientData);
    const clientWs = clientSheet.addWorksheet("Client Details");
    clientWs.addRow([
      "Client Name", "Client Type", "Last Invoice Amount", "Payment Cycle",
      "Project Start Date", "Work Order Valid till",
    ]);
    clientData.forEach(client => {
      clientWs.addRow([
        client.clientName,
        client.clientType,
        client.invoiceSize,
        client.paymentCycle,
        client.startDate,
        client.endDate,
      ]);
    });
    const clientBuffer = await clientSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/ClientDetails/Client_Details.xlsx`,
      Body: clientBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    res.status(200).json({
      message: "Data submitted and stored successfully",
      folder: `https://${BUCKET_NAME}.s3.${s3.config.region}.amazonaws.com/${superFolder}/`,
    });
  } catch (error) {
    console.error("Error submitting data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
