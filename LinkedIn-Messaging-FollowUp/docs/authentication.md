# Authentication & Authorization Strategy

## Overview
The LinkedIn Messaging Follow-Up system uses WordPress Application Passwords and PMpro integration for secure, long-lived authentication across Chrome extension and web portal components.

## Authentication Methods

### Chrome Extension Authentication
**Method**: WordPress Application Passwords + Basic Auth
**Duration**: Long-lived (until manually revoked)
**Security**: Separate from main WordPress password

#### Setup Process (One-time per user)
1. **User logs into WordPress dashboard** at `australiansidehustles.com.au/wp-admin`
2. **Navigate to profile**: Users → Edit Profile (or their own profile)
3. **Generate Application Password**:
   - Scroll to "Application Passwords" section
   - Enter application name: "LinkedIn Lead Extension"
   - Click "Add New Application Password"
   - WordPress generates unique password (e.g., `wxyz 1234 5678 abcd`)
4. **User copies credentials**:
   - Username: Their WordPress username
   - Password: The generated application password
5. **Configure Chrome Extension**:
   - First time using extension → popup asks for credentials
   - User enters WordPress username + application password
   - Extension stores credentials securely in Chrome storage
   - Extension validates credentials with server

#### API Authentication Flow
```javascript
// Chrome Extension API Call Example
const apiCall = {
  method: 'POST',
  url: 'https://your-server.com/api/leads/create',
  headers: {
    'Authorization': 'Basic ' + btoa(username + ':' + applicationPassword),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(leadData)
}
```

### Web Portal Authentication
**Method**: WordPress Cookie Authentication + Nonces
**Duration**: WordPress session length (configurable)
**Security**: Standard WordPress security practices

#### Login Flow
1. **User visits web portal** (e.g., `australiansidehustles.com.au/lead-portal`)
2. **Check authentication**: Server checks for valid WordPress session
3. **If not authenticated**: Redirect to WordPress login page
4. **WordPress login**: User logs in with normal WordPress credentials
5. **PMpro validation**: Server checks active subscription status
6. **Redirect back**: User returned to portal with valid session
7. **Nonce generation**: Portal pages include WordPress nonces for API security

#### API Authentication Flow
```javascript
// Web Portal API Call Example
$.ajax({
  url: wpApiSettings.root + 'wp/v2/leads/1',
  method: 'POST',
  beforeSend: function(xhr) {
    xhr.setRequestHeader('X-WP-Nonce', wpApiSettings.nonce);
  },
  data: { title: 'Updated Lead' }
});
```

## Authorization & Subscription Control

### PMpro Integration
Both authentication methods automatically integrate with PMpro subscription status:

#### Subscription Validation
```php
// Server-side validation for every API call
function validate_user_subscription($user_id) {
    // Check if user has active PMpro membership
    if (!pmpro_hasMembershipLevel(null, $user_id)) {
        return false; // No active subscription
    }
    
    // Check specific membership level if needed
    $user_level = pmpro_getMembershipLevelForUser($user_id);
    if (!$user_level || $user_level->status !== 'active') {
        return false; // Subscription expired/cancelled
    }
    
    return true; // Valid subscription
}
```

#### Access Control Flow
1. **API Request Received** (Chrome extension or web portal)
2. **Authenticate User** (Application Password or Cookie + Nonce)
3. **Validate Subscription** (PMpro membership check)
4. **Return Response**:
   - ✅ Valid subscription: Process request normally
   - ❌ No subscription: Return 403 with renewal link
   - ❌ Invalid auth: Return 401 with login prompt

### Multi-Tenant Data Isolation
Each user's WordPress account determines their tenant/client organization:

```php
// Determine client from WordPress user
function get_client_id_from_user($user_id) {
    // Option 1: Custom user meta field
    $client_id = get_user_meta($user_id, 'pmpro_client_id', true);
    
    // Option 2: Map from membership level
    $level = pmpro_getMembershipLevelForUser($user_id);
    $client_id = get_level_client_mapping($level->id);
    
    // Option 3: Custom field in PMpro checkout
    return $client_id;
}
```

## Security Considerations

### Application Password Security
- **Unique per application**: Each extension gets separate password
- **Revokable**: Users can revoke access anytime from WordPress dashboard
- **Limited scope**: Only grants API access, not WordPress admin access
- **Separate from main password**: Compromised app password doesn't affect main account

### Data Protection
- **HTTPS Required**: All API calls must use SSL/TLS
- **Rate Limiting**: Prevent abuse with request throttling
- **Input Validation**: Sanitize all LinkedIn data before storage
- **Multi-tenant Isolation**: Strict separation of client data

### WordPress Integration
- **Standard Security**: Leverages WordPress core security features
- **PMpro Compliance**: Follows PMpro best practices
- **Audit Logging**: Log all subscription changes and API access

## Error Handling & User Experience

### Chrome Extension Error States
```javascript
// Handle authentication errors
switch (response.status) {
  case 401:
    showLoginPrompt("Please verify your WordPress credentials");
    break;
  case 403:
    showSubscriptionError("Subscription required", renewalLink);
    break;
  case 429:
    showRateLimit("Too many requests, please wait");
    break;
}
```

### Common Error Scenarios
1. **First-time user**: Guide through Application Password setup
2. **Expired subscription**: Clear message with renewal link
3. **Revoked password**: Prompt to generate new Application Password
4. **Network issues**: Graceful offline handling with retry logic

## Implementation Details

### Chrome Extension Storage
```javascript
// Securely store credentials
chrome.storage.sync.set({
  'wp_username': username,
  'wp_app_password': applicationPassword,
  'last_verified': Date.now()
});

// Validate stored credentials periodically
async function validateStoredCredentials() {
  const stored = await chrome.storage.sync.get(['wp_username', 'wp_app_password']);
  if (!stored.wp_username || !stored.wp_app_password) {
    promptForCredentials();
    return false;
  }
  
  // Test API call to verify credentials still work
  const isValid = await testAPIConnection(stored);
  if (!isValid) {
    promptForCredentials();
    return false;
  }
  
  return true;
}
```

### Server API Endpoints
```php
// WordPress REST API endpoint for extension
add_action('rest_api_init', function() {
  register_rest_route('linkedin-leads/v1', '/authenticate', [
    'methods' => 'POST',
    'callback' => 'verify_extension_auth',
    'permission_callback' => '__return_true'
  ]);
});

function verify_extension_auth($request) {
  $user = wp_authenticate_application_password(null, 
    $request->get_header('authorization'));
  
  if (is_wp_error($user)) {
    return new WP_Error('invalid_auth', 'Invalid credentials', ['status' => 401]);
  }
  
  if (!validate_user_subscription($user->ID)) {
    return new WP_Error('subscription_required', 'Active subscription required', 
      ['status' => 403]);
  }
  
  return [
    'authenticated' => true,
    'user_id' => $user->ID,
    'client_id' => get_client_id_from_user($user->ID),
    'subscription_status' => 'active'
  ];
}
```

## Setup Instructions for Users

### For Chrome Extension Users
1. **Install extension** from Chrome Web Store
2. **Visit WordPress dashboard** → Users → Your Profile
3. **Create Application Password**:
   - Application Name: "LinkedIn Lead Extension"
   - Copy generated password
4. **Configure extension**:
   - Click extension icon → Settings
   - Enter WordPress username and application password
   - Click "Authenticate"
5. **Start using**: Extension now works on LinkedIn.com

### For Web Portal Users
1. **Visit portal URL** (provided by admin)
2. **Login with WordPress account** (same as usual)
3. **Portal automatically checks subscription** and grants access
4. **No additional setup required**

## Troubleshooting

### Common Issues
- **Extension not working**: Check if Application Password is correct
- **Subscription errors**: Verify PMpro membership status in WordPress
- **Connection issues**: Ensure HTTPS and check firewall settings
- **Multi-tenant problems**: Verify client_id mapping in user profile

### Support Resources
- WordPress Application Passwords documentation
- PMpro membership management guides
- Chrome extension troubleshooting steps
