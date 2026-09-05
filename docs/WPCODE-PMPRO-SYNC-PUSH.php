<?php
/**
 * WPCode Snippet: PMPro Sync Push
 *
 * Pushes PMPro membership data to our webhook server.
 * Add as PHP snippet in WPCode. Set to run on "Front-end" or "Admin" as needed.
 *
 * Trigger: Cron hits https://yoursite.com/?pmpro_sync_push=YOUR_SECRET
 * Replace YOUR_SECRET with your PB_WEBHOOK_SECRET value.
 *
 * Cron setup (e.g. cron-job.org):
 *   URL: https://australiansidehustles.com.au/?pmpro_sync_push=YOUR_SECRET
 *   Schedule: Daily (e.g. 2:00 AM AEST)
 *
 * Debug: Logs to wp-content/pmpro-sync-push.log (no wp-config changes needed)
 */
function pmpro_sync_push_log($msg) {
	$log = defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR . '/pmpro-sync-push.log' : __DIR__ . '/../wp-content/pmpro-sync-push.log';
	file_put_contents($log, '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n", FILE_APPEND);
}

add_action('wp_loaded', function () {
	$key = isset($_GET['pmpro_sync_push']) ? sanitize_text_field($_GET['pmpro_sync_push']) : '';
	if (empty($key)) {
		return;
	}

	pmpro_sync_push_log('TRIGGERED - key length: ' . strlen($key));

	global $wpdb;
	$mu_table = $wpdb->prefix . 'pmpro_memberships_users';
	$ml_table = $wpdb->prefix . 'pmpro_membership_levels';

	// Check if PMPro tables exist (no PMPro functions needed)
	if ($wpdb->get_var("SHOW TABLES LIKE '{$mu_table}'") !== $mu_table) {
		pmpro_sync_push_log('PMPro table not found: ' . $mu_table);
		return;
	}

	// Get active members with level info - direct DB query, no PMPro functions
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT mu.user_id, mu.membership_id AS level_id, mu.enddate, ml.name AS level_name
			 FROM {$mu_table} mu
			 LEFT JOIN {$ml_table} ml ON ml.id = mu.membership_id
			 WHERE mu.status = %s",
			'active'
		),
		ARRAY_A
	);

	$memberships = array();
	foreach ((array) $rows as $row) {
		$memberships[] = array(
			'wpUserId'  => (int) $row['user_id'],
			'levelId'   => (int) $row['level_id'],
			'levelName' => !empty($row['level_name']) ? $row['level_name'] : 'Unknown',
			'enddate'   => !empty($row['enddate']) ? $row['enddate'] : null,
		);
	}

	$payload = array(
		'secret'      => $key,
		'memberships' => $memberships,
	);

	pmpro_sync_push_log('Sending ' . count($memberships) . ' members to pb-webhook-server...');

	$response = wp_remote_post(
		'https://pb-webhook-server.onrender.com/api/pmpro-sync-push',
		array(
			'timeout'  => 30,
			'blocking' => true,
			'headers'  => array('Content-Type' => 'application/json'),
			'body'     => wp_json_encode($payload),
		)
	);

	if (is_wp_error($response)) {
		pmpro_sync_push_log('wp_remote_post FAILED (WP_Error): ' . $response->get_error_message());
		pmpro_sync_push_log('Error code: ' . $response->get_error_code());
		return;
	}

	$code = wp_remote_retrieve_response_code($response);
	$body = wp_remote_retrieve_body($response);
	if ($code >= 200 && $code < 300) {
		pmpro_sync_push_log('Success: HTTP ' . $code . ' - ' . count($memberships) . ' members sent');
	} else {
		pmpro_sync_push_log('Failed: HTTP ' . $code . ' - ' . substr($body, 0, 300));
	}
}, 20);
