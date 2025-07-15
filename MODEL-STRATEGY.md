# Model Strategy Decision

## Environment Variables
```bash
# Backend scoring (existing)
GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06

# Frontend editing (new)
GEMINI_EDITING_MODEL_ID=gemini-2.5-pro
```

## Frontend (Attribute Editing)
- **Model**: `process.env.GEMINI_EDITING_MODEL_ID` (defaults to `gemini-2.5-pro`)
- **Purpose**: Help users craft high-quality scoring rubrics
- **Why Pro**: Complex reasoning, creative output, quality over speed
- **Volume**: Low (occasional editing sessions)

## Backend (Lead Scoring) 
- **Model**: `process.env.GEMINI_MODEL_ID` (unchanged - `gemini-2.5-pro-preview-05-06`)
- **Purpose**: Execute scoring against well-crafted rubrics
- **Why Flash**: Speed, cost efficiency for high-volume processing
- **Volume**: High (hundreds of leads)

## Benefits
✅ **Quality rubrics** - Pro model helps users create better instructions
✅ **Efficient scoring** - Flash model processes leads quickly 
✅ **Cost optimized** - Expensive model only for low-volume editing
✅ **Best output** - Well-designed rubrics + fast execution
✅ **Configurable** - Both models can be changed via environment variables

## Implementation
- Frontend API routes use `GEMINI_EDITING_MODEL_ID` for editing
- Backend scoring keeps existing `GEMINI_MODEL_ID` setup
- No changes needed to existing scoring system
