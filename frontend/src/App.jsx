import { BrowserRouter, Route, Routes } from 'react-router-dom'
import NavBar from './components/NavBar'
import Alerts from './pages/Alerts'
import AddCard from './pages/AddCard'
import CardDetail from './pages/CardDetail'
import Collection from './pages/Collection'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import SetChecklists from './pages/SetChecklists'
import SetDetail from './pages/SetDetail'
import Settings from './pages/Settings'
import SellingDashboard from './pages/SellingDashboard'
import Strategy from './pages/Strategy'

export default function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <main className="pt-2">
        <Routes>
          <Route path="/"           element={<Dashboard />} />
          <Route path="/cards"      element={<Collection />} />
          <Route path="/cards/:id"  element={<CardDetail />} />
          <Route path="/add"        element={<AddCard />} />
          <Route path="/sets"       element={<SetChecklists />} />
          <Route path="/sets/:id"   element={<SetDetail />} />
          <Route path="/selling"    element={<SellingDashboard />} />
          <Route path="/strategy"   element={<Strategy />} />
          <Route path="/alerts"     element={<Alerts />} />
          <Route path="/pipeline"   element={<Pipeline />} />
          <Route path="/settings"   element={<Settings />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
