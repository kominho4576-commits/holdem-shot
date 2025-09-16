// server placeholder
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer,{cors:{origin:'*'}})

app.get('/health',(_,res)=>res.json({ok:true}))

io.on('connection',(s)=>{
  console.log('socket connected',s.id)
})

httpServer.listen(process.env.PORT||8080)
