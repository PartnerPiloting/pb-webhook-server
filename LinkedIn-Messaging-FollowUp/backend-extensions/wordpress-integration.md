# Required WordPress Custom Endpoints

## Overview
The LinkedIn Messaging Follow-Up system requires custom WordPress endpoints to handle authentication, subscription validation, and client mapping. These endpoints should be added to your WordPress site.

## Custom Plugin Structure

Create a WordPress plugin at: `wp-content/plugins/linkedin-extension-auth/linkedin-extension-auth.php`

```php
<?php
/**
 * Plugin Name: LinkedIn Extension Authentication
 * Description: Custom endpoints for LinkedIn Messaging Follow-Up system
 * Version: 1.0.0
 * Author: Your Name
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Register REST API endpoints
add_action('rest_api_init', 'linkedin_extension_register_routes');

function linkedin_extension_register_routes() {
    // Subscription validation endpoint
    register_rest_route('linkedin-extension/v1', '/subscription/(?P<user_id>\d+)', array(
        'methods' => 'GET',
        'callback' => 'linkedin_extension_check_subscription',
        'permission_callback' => 'linkedin_extension_verify_api_secret',
        'args' => array(
            'user_id' => array(
                'validate_callback' => function($param, $request, $key) {
                    return is_numeric($param);
                }
            ),
        ),
    ));

    // Client mapping endpoint
    register_rest_route('linkedin-extension/v1', '/client-mapping/(?P<user_id>\d+)', array(
        'methods' => 'GET',
        'callback' => 'linkedin_extension_get_client_mapping',
        'permission_callback' => 'linkedin_extension_verify_api_secret',
        'args' => array(
            'user_id' => array(
                'validate_callback' => function($param, $request, $key) {
                    return is_numeric($param);
                }
            ),
        ),
    ));

    // Session validation endpoint (optional)
    register_rest_route('linkedin-extension/v1', '/validate-session', array(
        'methods' => 'POST',
        'callback' => 'linkedin_extension_validate_session',
        'permission_callback' => 'linkedin_extension_verify_api_secret',
    ));
}

/**
 * Verify API secret for endpoint access
 */
function linkedin_extension_verify_api_secret($request) {
    $secret_header = $request->get_header('X-API-Secret');
    $expected_secret = get_option('linkedin_extension_api_secret', '');
    
    if (empty($expected_secret)) {
        // Set up a default secret if none exists
        $expected_secret = wp_generate_password(32, false);
        update_option('linkedin_extension_api_secret', $expected_secret);
    }
    
    return $secret_header === $expected_secret;
}

/**
 * Check PMpro subscription status
 */
function linkedin_extension_check_subscription($request) {
    $user_id = $request['user_id'];
    
    // Check if PMpro is active
    if (!function_exists('pmpro_hasMembershipLevel')) {
        return new WP_REST_Response(array(
            'active' => false,
            'error' => 'PMpro not installed'
        ), 200);
    }
    
    // Check if user has any active membership level
    $has_membership = pmpro_hasMembershipLevel(null, $user_id);
    
    if (!$has_membership) {
        return new WP_REST_Response(array(
            'active' => false,
            'reason' => 'No active membership'
        ), 200);
    }
    
    // Get specific membership details
    $membership_level = pmpro_getMembershipLevelForUser($user_id);
    
    if (!$membership_level || $membership_level->status !== 'active') {
        return new WP_REST_Response(array(
            'active' => false,
            'reason' => 'Membership not active',
            'status' => $membership_level ? $membership_level->status : 'none'
        ), 200);
    }
    
    return new WP_REST_Response(array(
        'active' => true,
        'level_id' => $membership_level->id,
        'level_name' => $membership_level->name,
        'expiry_date' => $membership_level->enddate
    ), 200);
}

/**
 * Get client ID mapping for user
 */
function linkedin_extension_get_client_mapping($request) {
    $user_id = $request['user_id'];
    
    // Option 1: Check custom user meta field
    $client_id = get_user_meta($user_id, 'linkedin_extension_client_id', true);
    
    if ($client_id) {
        return new WP_REST_Response(array(
            'clientId' => $client_id,
            'source' => 'user_meta'
        ), 200);
    }
    
    // Option 2: Map from membership level
    if (function_exists('pmpro_getMembershipLevelForUser')) {
        $membership_level = pmpro_getMembershipLevelForUser($user_id);
        
        if ($membership_level) {
            $level_mappings = get_option('linkedin_extension_level_mappings', array());
            $client_id = isset($level_mappings[$membership_level->id]) ? $level_mappings[$membership_level->id] : null;
            
            if ($client_id) {
                return new WP_REST_Response(array(
                    'clientId' => $client_id,
                    'source' => 'membership_level',
                    'level_id' => $membership_level->id
                ), 200);
            }
        }
    }
    
    // Option 3: Default mapping for specific users (Guy Wilson case)
    $default_mappings = get_option('linkedin_extension_user_mappings', array(
        // Add Guy Wilson's WordPress user ID here
        // '1' => 'guy-wilson-client-id'
    ));
    
    if (isset($default_mappings[$user_id])) {
        return new WP_REST_Response(array(
            'clientId' => $default_mappings[$user_id],
            'source' => 'user_mapping'
        ), 200);
    }
    
    return new WP_REST_Response(array(
        'clientId' => null,
        'error' => 'No client mapping found'
    ), 200);
}

/**
 * Validate WordPress session cookie (optional)
 */
function linkedin_extension_validate_session($request) {
    $cookie = $request->get_param('cookie');
    
    if (empty($cookie)) {
        return new WP_REST_Response(array(
            'valid' => false,
            'error' => 'No cookie provided'
        ), 200);
    }
    
    // WordPress cookie validation is complex
    // For now, return a basic validation
    // You may need to implement custom cookie parsing
    
    return new WP_REST_Response(array(
        'valid' => false,
        'error' => 'Cookie validation not implemented'
    ), 200);
}

/**
 * Admin page to manage settings
 */
add_action('admin_menu', 'linkedin_extension_admin_menu');

function linkedin_extension_admin_menu() {
    add_options_page(
        'LinkedIn Extension Settings',
        'LinkedIn Extension',
        'manage_options',
        'linkedin-extension-settings',
        'linkedin_extension_admin_page'
    );
}

function linkedin_extension_admin_page() {
    if (isset($_POST['save_settings'])) {
        // Save API secret
        if (!empty($_POST['api_secret'])) {
            update_option('linkedin_extension_api_secret', sanitize_text_field($_POST['api_secret']));
        }
        
        // Save user mappings
        $user_mappings = array();
        if (!empty($_POST['user_mappings'])) {
            $lines = explode("\n", $_POST['user_mappings']);
            foreach ($lines as $line) {
                $parts = explode(':', trim($line));
                if (count($parts) === 2) {
                    $user_mappings[trim($parts[0])] = trim($parts[1]);
                }
            }
        }
        update_option('linkedin_extension_user_mappings', $user_mappings);
        
        echo '<div class="notice notice-success"><p>Settings saved!</p></div>';
    }
    
    $api_secret = get_option('linkedin_extension_api_secret', '');
    $user_mappings = get_option('linkedin_extension_user_mappings', array());
    
    ?>
    <div class="wrap">
        <h1>LinkedIn Extension Settings</h1>
        
        <form method="post">
            <h2>API Security</h2>
            <table class="form-table">
                <tr>
                    <th scope="row">API Secret</th>
                    <td>
                        <input type="text" name="api_secret" value="<?php echo esc_attr($api_secret); ?>" class="regular-text" />
                        <p class="description">Secret key for API authentication. Copy this to your server environment variables.</p>
                    </td>
                </tr>
            </table>
            
            <h2>User to Client Mapping</h2>
            <table class="form-table">
                <tr>
                    <th scope="row">User Mappings</th>
                    <td>
                        <textarea name="user_mappings" rows="10" cols="50" class="large-text"><?php
                        foreach ($user_mappings as $user_id => $client_id) {
                            echo esc_textarea($user_id . ':' . $client_id . "\n");
                        }
                        ?></textarea>
                        <p class="description">
                            Map WordPress User IDs to Client IDs. Format: user_id:client_id (one per line)<br>
                            Example: 1:guy-wilson-client-id
                        </p>
                    </td>
                </tr>
            </table>
            
            <?php submit_button('Save Settings', 'primary', 'save_settings'); ?>
        </form>
        
        <h2>API Endpoints</h2>
        <p>The following endpoints are available:</p>
        <ul>
            <li><code>GET /wp-json/linkedin-extension/v1/subscription/{user_id}</code></li>
            <li><code>GET /wp-json/linkedin-extension/v1/client-mapping/{user_id}</code></li>
            <li><code>POST /wp-json/linkedin-extension/v1/validate-session</code></li>
        </ul>
    </div>
    <?php
}

// Initialize default settings
register_activation_hook(__FILE__, 'linkedin_extension_activate');

function linkedin_extension_activate() {
    // Generate API secret if none exists
    if (!get_option('linkedin_extension_api_secret')) {
        $secret = wp_generate_password(32, false);
        update_option('linkedin_extension_api_secret', $secret);
    }
}
?>
```

## Environment Variables for pb-webhook-server

Add these to your pb-webhook-server `.env` file:

```bash
# WordPress Integration
WORDPRESS_API_URL=https://australiansidehustles.com.au/wp-json
LINKEDIN_EXTENSION_SECRET=your-secret-from-wordpress-admin

# Extension CORS (if needed)
EXTENSION_CORS_ORIGINS=chrome-extension://your-extension-id
```

## Setup Steps

### 1. Install WordPress Plugin
1. Create the plugin file in WordPress
2. Activate the plugin
3. Go to Settings → LinkedIn Extension
4. Copy the API secret to your pb-webhook-server environment variables

### 2. Configure User Mappings
In the WordPress admin, set up user to client mappings:
```
1:guy-wilson-client-id
2:another-client-id
```

### 3. Test Endpoints
```bash
# Test subscription check
curl -H "X-API-Secret: your-secret" \
  https://australiansidehustles.com.au/wp-json/linkedin-extension/v1/subscription/1

# Test client mapping
curl -H "X-API-Secret: your-secret" \
  https://australiansidehustles.com.au/wp-json/linkedin-extension/v1/client-mapping/1
```

This integration ensures that each WordPress user is properly mapped to their corresponding client base in your multi-tenant system.
