<?php
/**
 * WPCode Snippet: PMPro Staged Webhook Diagnostics
 *
 * Add this as a PHP snippet in WPCode Pro.
 * Sends webhooks to our server when PMPro REST API requests are received and when PMPro completes.
 *
 * Webhook URL: https://pb-webhook-server.onrender.com/api/debug/pmpro-webhook-received
 */

// 1. REST request received (before any handler runs)
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	$route = $request->get_route();
	if ( strpos( $route, 'pmpro' ) !== false && strpos( $route, 'get_membership_level' ) !== false ) {
		$ip = $_SERVER['REMOTE_ADDR'] ?? '';
		if ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$ip = trim( explode( ',', $_SERVER['HTTP_X_FORWARDED_FOR'] )[0] );
		}
		wp_remote_post(
			'https://pb-webhook-server.onrender.com/api/debug/pmpro-webhook-received',
			array(
				'timeout'  => 5,
				'blocking' => false,
				'body'     => wp_json_encode( array(
					'stage'     => 'request_received',
					'route'     => $route,
					'ip'        => $ip,
					'timestamp' => gmdate( 'c' ),
				) ),
				'headers'  => array( 'Content-Type' => 'application/json' ),
			)
		);
	}
	return $result;
}, 10, 3 );

// 2. PMPro finished (when membership level is about to be returned)
add_filter( 'pmpro_get_membership_level_for_user', function ( $level, $user_id ) {
	$route = '/pmpro/v1/get_membership_level_for_user';
	$ip = $_SERVER['REMOTE_ADDR'] ?? '';
	if ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
		$ip = trim( explode( ',', $_SERVER['HTTP_X_FORWARDED_FOR'] )[0] );
	}
	wp_remote_post(
		'https://pb-webhook-server.onrender.com/api/debug/pmpro-webhook-received',
		array(
			'timeout'  => 5,
			'blocking' => false,
			'body'     => wp_json_encode( array(
				'stage'     => 'pmpro_finished',
				'route'     => $route,
				'ip'        => $ip,
				'user_id'   => $user_id,
				'timestamp' => gmdate( 'c' ),
			) ),
			'headers'  => array( 'Content-Type' => 'application/json' ),
		)
	);
	return $level;
}, 10, 2 );
