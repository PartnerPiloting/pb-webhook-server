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
 */
add_action('init', function () {
	$key = isset($_GET['pmpro_sync_push']) ? sanitize_text_field($_GET['pmpro_sync_push']) : '';
	if (empty($key)) {
		return;
	}

	// Require PMPro
	if (!function_exists('pmpro_get_membership_level_for_user')) {
		error_log('[PMPro Sync Push] PMPro not active');
		return;
	}

	global $wpdb;
	$table = $wpdb->prefix . 'pmpro_memberships_users';

	// Get distinct user IDs with active membership (status = 'active')
	$user_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT user_id FROM {$table} WHERE status = %s",
			'active'
		)
	);

	$memberships = array();
	foreach ((array) $user_ids as $user_id) {
		$level = pmpro_get_membership_level_for_user($user_id);
		if (empty($level)) {
			continue;
		}
		$memberships[] = array(
			'wpUserId'  => (int) $user_id,
			'levelId'   => isset($level->id) ? (int) $level->id : (int) $level->ID,
			'levelName' => isset($level->name) ? $level->name : (isset($level->level_name) ? $level->level_name : 'Unknown'),
			'enddate'   => isset($level->enddate) ? $level->enddate : null,
		);
	}

	$payload = array(
		'secret'      => $key,
		'memberships' => $memberships,
	);

	$response = wp_remote_post(
		'https://pb-webhook-server.onrender.com/api/pmpro-sync-push',
		array(
			'timeout'  => 30,
			'blocking' => true,
			'headers'  => array('Content-Type' => 'application/json'),
			'body'     => wp_json_encode($payload),
		)
	);

	$code = wp_remote_retrieve_response_code($response);
	$body = wp_remote_retrieve_body($response);
	if ($code >= 200 && $code < 300) {
		error_log('[PMPro Sync Push] Success: ' . count($memberships) . ' members sent');
	} else {
		error_log('[PMPro Sync Push] Failed: HTTP ' . $code . ' - ' . substr($body, 0, 200));
	}
}, 5);
