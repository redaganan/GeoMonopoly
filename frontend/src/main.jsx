import React from 'react'
import { createRoot } from 'react-dom/client'
import Dashboard from './components/Dashboard'
import LoginModal from './components/LoginModal'

const token = localStorage.getItem('token');
createRoot(document.getElementById('root')).render(token? <Dashboard/> : <LoginModal/> )
