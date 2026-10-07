"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import LeadsPage from "../../components/LeadsPage.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function LeadsPageRoute() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<LeadsPage />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
