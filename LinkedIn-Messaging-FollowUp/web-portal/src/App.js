import React, { useState } from 'react';
import Layout from './components/Layout';
import LeadSearchUpdate from './components/LeadSearchUpdate';
import FollowUpManager from './components/FollowUpManager';
import TopScoringPosts from './components/TopScoringPosts';
import NewLeads from './components/NewLeads';

function App() {
  const [activeTab, setActiveTab] = useState('search');

  const renderActiveComponent = () => {
    switch (activeTab) {
      case 'search':
        return <LeadSearchUpdate />;
      case 'followup':
        return <FollowUpManager />;
      case 'topscoring':
        return <TopScoringPosts />;
      case 'newleads':
        return <NewLeads />;
      default:
        return <LeadSearchUpdate />;
    }
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderActiveComponent()}
    </Layout>
  );
}

export default App;
