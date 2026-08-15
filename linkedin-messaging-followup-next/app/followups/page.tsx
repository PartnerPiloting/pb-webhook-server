"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import FollowUpsQueue from "../../components/FollowUpsQueue.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function FollowUpsPage() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<FollowUpsQueue />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
