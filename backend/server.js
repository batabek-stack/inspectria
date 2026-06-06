const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { initDb } = require("./db");

const authRoutes = require("./routes/auth");
const organizationRoutes = require("./routes/organizations");
const userRoutes = require("./routes/users");
const checklistRoutes = require("./routes/checklists");
const assignmentRoutes = require("./routes/assignments");
const draftRoutes = require("./routes/drafts");
const reportRoutes = require("./routes/reports");
const walkthroughRoutes = require("./routes/walkthroughs");
const emailRoutes = require("./routes/emails");
const uploadRoutes = require("./routes/uploads");
const localFileRoutes = require("./routes/localFiles");
const aiActionPlanRoutes = require("./routes/aiActionPlan");
const billingRoutes = require("./routes/billing");
const downloadRoutes = require("./routes/downloads");
const messageRoutes = require("./routes/messages");

const app = express();
const frontendDistPath = path.join(__dirname, "..", "frontend", "dist");
const hasBuiltFrontend = fs.existsSync(path.join(frontendDistPath, "index.html"));

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: false, limit: "25mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/health", (_, res) => res.json({ ok: true, app: "Inspectria" }));
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/checklists", checklistRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/drafts", draftRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/walkthroughs", walkthroughRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/local-files", localFileRoutes);
app.use("/api/ai", aiActionPlanRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/messages", messageRoutes);
app.use("/downloads", downloadRoutes);

if (hasBuiltFrontend) {
  app.use(
    express.static(frontendDistPath, {
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store");
      },
    })
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
      return next();
    }

    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  app.get("/", (_, res) => res.json({ ok: true, app: "Inspectria" }));
}

app.use((error, _, res, __) => {
  console.error(error);
  const statusCode = Number(error.statusCode || error.status || 500);
  res
    .status(statusCode >= 400 && statusCode < 600 ? statusCode : 500)
    .json({ message: error.message || "Internal server error" });
});

const PORT = Number(process.env.PORT || 4000);

initDb()
  .then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Inspectria running on http://localhost:${PORT}`);
    });

    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
      }

      console.error("Inspectria could not start.");
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error("Inspectria database initialization failed.");
    console.error(error);
    process.exit(1);
  });
