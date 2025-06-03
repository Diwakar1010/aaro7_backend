const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ExcelJS = require("exceljs");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "150mb" })); // Increased to handle Netlify uploads

// Check AWS credentials
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("Missing AWS credentials in environment");
  process.exit(1);
}

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

    if (!businessData?.businessName) {
      return res.status(400).json({ error: "Missing business name" });
    }

    const superFolder = `${businessData.businessName}`;

    const uploadFileToS3 = async (file, folder, prefix = "") => {
      if (!file?.data || !file?.name || !file?.type) {
        throw new Error(`Invalid file input: ${JSON.stringify(file)}`);
      }

      const buffer = Buffer.from(file.data, "base64");
      const fileName = `${businessData.businessName}_${prefix}_${file.name}`;
      const key = `${superFolder}/${folder}/${fileName}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      });

      await s3.send(command);
      console.log(`✅ Uploaded file: ${key}`);
    };

    const businessInfo = [];
    for (const key in businessData) {
      if (businessData[key]?.data) {
        await uploadFileToS3(businessData[key], `${businessData.businessName}_BusinessDetails`, key);
        businessInfo.push({ label: key, fileName: businessData[key].name });
      }
    }

    const kycInfo = [];
    for (const key in kycData) {
      if (kycData[key]?.data) {
        await uploadFileToS3(kycData[key], `${businessData.businessName}_KYCDetails`, key);
        kycInfo.push({ label: key, fileName: kycData[key].name });
      }
    }

    const financialInfo = [];
    for (const key in financialFiles) {
      const fileArray = financialFiles[key];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        if (file?.data) {
          await uploadFileToS3(file, `${businessData.businessName}_FinancialDetails`, `${key}_${i}`);
          financialInfo.push({ label: key, index: i, fileName: file.name });
        }
      }
    }

    for (let i = 0; i < clientData.length; i++) {
      const client = clientData[i];
      if (client?.payrollListUpload) {
        await uploadFileToS3(client.payrollListUpload, `${businessData.businessName}_ClientDetails`, `${client.clientName}_payroll`);
      }
      if (client?.workOrderUpload) {
        await uploadFileToS3(client.workOrderUpload, `${businessData.businessName}_ClientDetails`, `${client.clientName}_workorder`);
      }
      if (client?.invoiceUpload) {
        await uploadFileToS3(client.invoiceUpload, `${businessData.businessName}_ClientDetails`, `${client.clientName}_invoice`);
      }
    }

    const createExcelAndUpload = async (workbook, sheetName, headers, rows, folderName, fileName) => {
      const ws = workbook.addWorksheet(sheetName);
      ws.addRow(headers);
      rows.forEach(row => ws.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${superFolder}/${folderName}/${fileName}`,
        Body: buffer,
        ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
    };

    await createExcelAndUpload(
      new ExcelJS.Workbook(),
      "Business Details",
      ["Business Name", "Entity", "Industry", "Business Age(in Years)", "Registered Address", "Head Office Address"],
      [[businessData.businessName, businessData.entity, businessData.industry, businessData.businessAge, businessData.registeredOffice, businessData.headOffice]],
      `${businessData.businessName}_BusinessDetails`,
      `${businessData.businessName}_Business_Details.xlsx`
    );

    await createExcelAndUpload(
      new ExcelJS.Workbook(),
      "KYC Details",
      ["Document Name", "YES / NO"],
      kycInfo.map(item => [item.label, item.fileName ? "YES" : "NO"]),
      `${businessData.businessName}_KYCDetails`,
      `${businessData.businessName}_KYC_Details.xlsx`
    );

    await createExcelAndUpload(
      new ExcelJS.Workbook(),
      "Financial Details",
      ["Document Name", "YES / NO"],
      financialInfo.map(item => [item.label, item.fileName ? "YES" : "NO"]),
      `${businessData.businessName}_FinancialDetails`,
      `${businessData.businessName}_Financial_Details.xlsx`
    );

    await createExcelAndUpload(
      new ExcelJS.Workbook(),
      "Client Details",
      ["Client Name", "Client Type", "Last Invoice Amount", "Payment Cycle (in Days)", "Project Start Date", "Work Order Valid till"],
      clientData.map(client => [
        client.clientName,
        client.clientType,
        client.invoiceSize,
        client.paymentCycle,
        client.startDate,
        client.endDate
      ]),
      `${businessData.businessName}_ClientDetails`,
      `${businessData.businessName}_Client_Details.xlsx`
    );

    res.status(200).json({
      message: "Data submitted and stored successfully",
      folder: `https://${BUCKET_NAME}.s3.${s3.config.region}.amazonaws.com/${superFolder}/`,
    });

  } catch (error) {
    console.error("Error submitting data:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(` Server running on port ${PORT}`);
});
