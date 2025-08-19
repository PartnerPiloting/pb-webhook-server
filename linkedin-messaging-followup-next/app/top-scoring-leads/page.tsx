"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import TopScoringLeads from "../../components/TopScoringLeads.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function TopScoringLeadsPage() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<TopScoringLeads />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
