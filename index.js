const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ExcelJS = require("exceljs");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Allow Netlify frontend
app.use(cors({ origin: "*", methods: ["POST"], allowedHeaders: ["Content-Type"] }));

// Handle large JSON payloads
app.use(express.json({ limit: "150mb" }));

// AWS S3 Setup
const s3 = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = "onboardingformbucket";

app.post("/submit", async (req, res) => {
  console.log("🔵 Received /submit POST request");

  try {
    const { businessData, clientData, kycData, financialFiles } = req.body;

    if (!businessData || !businessData.businessName) {
      console.error("❌ Missing businessData or businessName");
      return res.status(400).json({ error: "Missing business data" });
    }

    const superFolder = businessData.businessName;

    const uploadFileToS3 = async (file, folder, prefix = "") => {
      try {
        const buffer = Buffer.from(file.data, "base64");
        const fileName = `${businessData.businessName}-${prefix}`;

        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${superFolder}/${folder}/${fileName}`,
          Body: buffer,
          ContentType: file.type,
          ContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
        });

        await s3.send(command);
        console.log(`✅ Uploaded: ${fileName} → ${folder}`);
      } catch (err) {
        console.error(`❌ S3 upload failed for ${file.name}:`, err.stack || err);
        throw err;
      }
    };

    // Upload Business Files
    const businessInfo = [];
    for (const key in businessData) {
      if (businessData[key]?.data) {
        await uploadFileToS3(businessData[key], `${businessData.businessName}-BusinessDetails`, key);
        businessInfo.push({ label: key, fileName: businessData[key].name });
      }
    }

    // Upload KYC Files
    const kycInfo = [];
    for (const key in kycData) {
      if (kycData[key]?.data) {
        await uploadFileToS3(kycData[key], `${businessData.businessName}-KYCDetails`, key);
        kycInfo.push({ label: key, fileName: kycData[key].name });
      }
    }

    // Upload Financial Files
    const financialInfo = [];
    for (const key in financialFiles) {
      const fileArray = financialFiles[key];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        if (file?.data) {
          await uploadFileToS3(file, `${businessData.businessName}-FinancialDetails`, `${key}-${i}`);
          financialInfo.push({ label: key, index: i, fileName: file.name });
        }
      }
    }

    // Upload Client Files
    for (const client of clientData) {
      if (client?.payrollListUpload) {
        await uploadFileToS3(client.payrollListUpload, `${businessData.businessName}-ClientDetails`, `${client.clientName}-Employee_payroll_list`);
        uploadedFileNames.push(client.payrollListUpload.name);
      }
      if (client?.workOrderUpload) {
        await uploadFileToS3(client.workOrderUpload, `${businessData.businessName}-ClientDetails`, `${client.clientName}-workorder`);
        uploadedFileNames.push(client.workOrderUpload.name);
      }
      if (client?.invoiceUpload) {
        await uploadFileToS3(client.invoiceUpload, `${businessData.businessName}-ClientDetails`, `${client.clientName}-recent_invoice`);
        uploadedFileNames.push(client.invoiceUpload.name);
      }
    }

    // Excel: Business Details
    const businessSheet = new ExcelJS.Workbook();
    const businessWs = businessSheet.addWorksheet("Business Details");
    businessWs.addRow(["Business Name", "Entity", "Industry", "Business Age(in Years)", "Registered Address", "Head Office Address"]);
    businessWs.addRow([
      businessData.businessName,
      businessData.entity,
      businessData.industry,
      businessData.businessAge,
      businessData.registeredOffice,
      businessData.headOffice,
    ]);
    const businessBuffer = await businessSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/${businessData.businessName}-BusinessDetails/${businessData.businessName}-Business_Details.xlsx`,
      Body: businessBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Excel: KYC
    const kycSheet = new ExcelJS.Workbook();
    const kycWs = kycSheet.addWorksheet("KYC Details");
    kycWs.addRow(["Document Name", "YES / NO"]);
    kycInfo.forEach(item => kycWs.addRow([item.label, item.fileName ? "YES" : "NO"]));
    const kycBuffer = await kycSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/${businessData.businessName}-KYCDetails/${businessData.businessName}-KYC_Details.xlsx`,
      Body: kycBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Excel: Financial
    const financialSheet = new ExcelJS.Workbook();
    const financialWs = financialSheet.addWorksheet("Financial Details");
    financialWs.addRow(["Document Name", "YES / NO"]);
    financialInfo.forEach(item => financialWs.addRow([item.label, item.fileName ? "YES" : "NO"]));
    const financialBuffer = await financialSheet.xlsx.writeBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${superFolder}/${businessData.businessName}-FinancialDetails/${businessData.businessName}-Financial_Details.xlsx`,
      Body: financialBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    // Excel: Client
    const clientSheet = new ExcelJS.Workbook();
    const clientWs = clientSheet.addWorksheet("Client Details");
    clientWs.addRow([
      "Client Name", "Client Type", "Last Invoice Amount", "Payment Cycle (in Days)",
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
      Key: `${superFolder}/${businessData.businessName}-ClientDetails/${businessData.businessName}-Client_Details.xlsx`,
      Body: clientBuffer,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    res.status(200).json({
      message: "✅ Data submitted and stored successfully",
      folder: `https://${BUCKET_NAME}.s3.${s3.config.region}.amazonaws.com/${superFolder}/`,
    });

  } catch (error) {
    console.error("❌ Server Error:", error.stack || error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// Server Port
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
