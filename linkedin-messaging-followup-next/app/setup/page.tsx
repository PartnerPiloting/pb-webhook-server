"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import SetupPage from "../../components/SetupPage.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function SetupPageRoute() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<SetupPage />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
