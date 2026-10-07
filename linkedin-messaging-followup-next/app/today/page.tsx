"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import TodayPage from "../../components/TodayPage.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function TodayPageRoute() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<TodayPage />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
