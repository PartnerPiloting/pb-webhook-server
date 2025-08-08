# Apify LinkedIn Profile Posts Integration Guide

## Overview

This guide documents the integration of Apify's LinkedIn Profile Posts service as a replacement for PhantomBuster's LinkedIn Activity Extractor. The Apify service offers superior multi-tenant capabilities, better pricing, and richer data extraction for the leadership development business model.

## Service Comparison

### PhantomBuster vs Apify
| Feature | PhantomBuster | Apify LinkedIn Profile Posts |
|---------|---------------|------------------------------|
| **Pricing** | Annual subscription (~$400/year) | $5 per 1,000 posts (usage-based) |
| **Multi-Tenant** | Complex cookie management | No cookies required |
| **Account Risk** | High (requires LinkedIn cookies) | None (no-cookies architecture) |
| **Data Quality** | Basic post content | Rich data with engagement metrics |
| **Automation** | Custom scheduling needed | Native cron scheduling |
| **Billing Model** | Fixed cost regardless of usage | Automatic usage-based billing |

## Technical Architecture

### Current PhantomBuster Webhook
- **Endpoint**: `POST /api/pb-webhook`
- **Secret**: `Diamond9753!!@@pb` (query parameter)
- **Function**: Processes LinkedIn posts from PhantomBuster
- **Status**: Working with hardcoded 'Guy-Wilson' client fix

### Proposed Apify Integration
- **New Endpoint**: `POST /api/apify-webhook`
- **Authentication**: API token-based
- **Function**: Process LinkedIn posts from Apify
- **Multi-Tenant**: Native support for multiple clients

## Data Structure Comparison

### PhantomBuster Output
```json
{
  "profileUrl": "https://linkedin.com/in/username",
  "postUrl": "https://linkedin.com/posts/...",
  "postText": "Post content...",
  "timePosted": "2 days ago",
  "likes": "123",
  "comments": "45"
}
```

### Apify Output (Richer Data)
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "urn": "7123456789012345678",
        "posted_at": {
          "date": "2025-05-15 14:30:20",
          "timestamp": 1745678901234
        },
        "text": "Post content...",
        "url": "https://linkedin.com/posts/...",
        "author": {
          "first_name": "John",
          "last_name": "Doe",
          "headline": "CEO at Example Company",
          "username": "johndoe",
          "profile_url": "https://linkedin.com/in/johndoe"
        },
        "stats": {
          "total_reactions": 123,
          "like": 100,
          "support": 5,
          "love": 10,
          "comments": 15,
          "reposts": 7
        },
        "media": {
          "type": "image",
          "url": "https://media.licdn.com/..."
        }
      }
    ]
  }
}
```

## Implementation Plan

### Phase 1: Webhook Endpoint Creation
1. **Create new endpoint** `/api/apify-webhook`
2. **Implement authentication** using Apify API tokens
3. **Data transformation** from Apify format to internal format
4. **Reuse existing sync function** `syncPBPostsToAirtable()`

### Phase 2: Multi-Tenant Scheduling
1. **Create Apify tasks** for each client profile
2. **Set up daily schedules** using cron expressions (`0 0 * * *`)
3. **Configure webhooks** to trigger your endpoint
4. **Client-specific configuration** management

### Phase 3: Migration Strategy
1. **Keep PhantomBuster** for Guy-Wilson (paid for full year)
2. **New clients** use Apify immediately
3. **Gradual migration** of existing clients based on value proposition

## Code Implementation

### New Webhook Endpoint
```javascript
// ---------------------------------------------------------------
// Apify LinkedIn Posts Webhook
// ---------------------------------------------------------------
router.post("/api/apify-webhook", async (req, res) => {
  try {
    // Authenticate using Apify token
    const authToken = req.headers.authorization;
    if (!authToken || !authToken.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Authorization token required" });
    }

    const token = authToken.split(' ')[1];
    if (token !== process.env.APIFY_WEBHOOK_TOKEN) {
      return res.status(403).json({ error: "Invalid token" });
    }

    console.log("Apify Webhook: Received payload");
    res.status(200).json({ message: "Webhook received. Processing in background." });

    // Background processing
    (async () => {
      try {
        const apifyData = req.body;
        
        if (!apifyData.success || !apifyData.data?.posts) {
          console.warn("Apify Webhook: Invalid payload structure");
          return;
        }

        // Transform Apify data to internal format
        const transformedPosts = apifyData.data.posts.map(post => ({
          profileUrl: post.author.profile_url,
          postUrl: post.url,
          postText: post.text,
          timePosted: post.posted_at.relative,
          likes: post.stats.like?.toString() || '0',
          comments: post.stats.comments?.toString() || '0',
          totalReactions: post.stats.total_reactions,
          reposts: post.stats.reposts,
          mediaType: post.media?.type,
          mediaUrl: post.media?.url
        }));

        // Auto-detect client or use header
        const clientId = req.headers['x-client-id'];
        const clientBase = await getClientBase(clientId);
        
        if (transformedPosts.length > 0 && clientBase) {
          const processed = await syncPBPostsToAirtable(transformedPosts, clientBase);
          console.log("Apify Webhook: Successfully processed", processed);
        }
        
      } catch (backgroundErr) {
        console.error("Apify Webhook: Background processing error:", backgroundErr);
      }
    })();

  } catch (initialErr) {
    console.error("Apify Webhook: Initial error:", initialErr);
    res.status(500).json({ error: initialErr.message });
  }
});
```

### Environment Variables Needed
```bash
APIFY_API_TOKEN=your_apify_api_token_here
APIFY_WEBHOOK_TOKEN=your_webhook_auth_token_here
```

## Apify Task Configuration

### Daily Schedule Setup
```json
{
  "name": "linkedin-posts-daily-guy-wilson",
  "userId": "YOUR_APIFY_USER_ID",
  "isEnabled": true,
  "isExclusive": true,
  "cronExpression": "0 0 * * *",
  "timezone": "UTC",
  "description": "Daily LinkedIn posts extraction for Guy-Wilson client",
  "actions": [
    {
      "type": "RUN_ACTOR",
      "actorId": "apimaestro/linkedin-profile-posts",
      "input": {
        "profileUrl": "https://linkedin.com/in/guy-wilson",
        "totalPostsToScrape": 100
      },
      "webhooks": [
        {
          "eventTypes": ["ACTOR.RUN.SUCCEEDED"],
          "requestUrl": "https://pb-webhook-server.onrender.com/api/apify-webhook",
          "payloadTemplate": "{{data}}",
          "headers": {
            "Authorization": "Bearer YOUR_WEBHOOK_TOKEN",
            "x-client-id": "Guy-Wilson"
          }
        }
      ]
    }
  ]
}
```

## Cost Analysis

### Multi-Tenant Pricing Benefits
- **PhantomBuster**: Fixed $400/year regardless of usage
- **Apify**: $5/1000 posts = ~$0.005 per post
- **Break-even**: 80,000 posts/year (219 posts/day)
- **Typical usage**: 10-50 posts/client/day = $0.05-$0.25/client/day

### Revenue Impact
- **Leaders pay based on actual usage**
- **No upfront subscription costs**
- **Scales automatically with client growth**
- **Better margins on light users**

## Data Quality Improvements

### Enhanced Analytics Available
1. **Engagement Breakdown**: Likes, supports, loves, insights, celebrates
2. **Media Attachments**: Images, videos, documents with URLs
3. **Post Types**: Regular, quotes, reshares, articles
4. **Precise Timestamps**: Exact posting times vs relative times
5. **Author Details**: Full profile information for each post

### Integration with Existing Scoring
- **Same sync function**: `syncPBPostsToAirtable()` works unchanged
- **Enhanced data**: Additional fields available for future scoring improvements
- **Backward compatibility**: Maintains existing data structure

## Risk Assessment

### Technical Risks: LOW
- **Well-documented API**: Comprehensive examples and support
- **Proven service**: 5,300+ successful runs, 4.1/5 rating
- **Multiple alternatives**: Several backup options available
- **Simple integration**: Standard REST API similar to current setup

### Business Risks: MINIMAL
- **Better pricing model**: Pay-per-use vs fixed cost
- **No account restrictions**: No-cookies approach eliminates LinkedIn bans
- **Vendor diversification**: Reduces dependency on single service
- **Easy rollback**: Can revert to PhantomBuster if needed

## Next Steps

1. **Create Apify account** and obtain API tokens
2. **Implement webhook endpoint** in development environment
3. **Test with single client** (Guy-Wilson profile)
4. **Validate data quality** and sync functionality
5. **Create production schedules** for all active clients
6. **Monitor costs** and performance metrics

## Support Resources

- **Apify Documentation**: https://docs.apify.com/
- **Actor Specific Docs**: https://apify.com/apimaestro/linkedin-profile-posts
- **API Reference**: https://docs.apify.com/api/v2
- **Support Response**: 1.2 hour average for issues
- **Community Discord**: https://discord.com/invite/jyEM2PRvMU

## Success Metrics

- **Cost per client**: Target <$10/month per active client
- **Data freshness**: Posts appear within 24 hours
- **System reliability**: >99% webhook success rate  
- **Client satisfaction**: Enhanced engagement analytics
- **Revenue growth**: Easier client onboarding due to usage-based pricing

---

*Last Updated: August 7, 2025*  
*Status: Ready for Implementation*
