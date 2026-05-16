This folder is the local TEST copy of MOD-Check-List.

Purpose:
- Test new features and patches on this computer only
- Keep the main project untouched until changes are verified
- Deploy tested source changes back to the main project with:
  powershell -ExecutionPolicy Bypass -File .\deploy_test_to_main.ps1

Local test routing:
- Frontend dev fallback API host is set to localhost:4000 in this TEST copy
- This copy is intended for local-only validation on this machine
## AI Action Plan Excel Test

Completed report screens now include an `AI Action Plan Excel` button. It sends failed YES/NO items to the backend endpoint below and downloads a trackable Excel file.

Backend endpoint:

```text
POST /api/ai/action-plan
```

For real AI-generated classification and actions, start the backend with Azure OpenAI:

```text
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your_api_key
AZURE_OPENAI_DEPLOYMENT=your_deployment_name
AZURE_OPENAI_API_VERSION=2024-10-21
```

Or use OpenAI directly:

```text
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

The AI receives an industry profile and department list, then classifies each failed item into the most likely department, owner role, estimated duration, priority, confidence, and corrective action. The default profile is Hotel / Hospitality.

For another sector, set `ACTION_PLAN_INDUSTRY_PROFILE_JSON` to a JSON object with `industry`, `departments`, and optional `durationGuidance`.

If no AI credentials are set, the endpoint returns a local fallback classification so the workflow can still be tested end to end.
