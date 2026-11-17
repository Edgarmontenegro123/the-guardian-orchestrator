import cluster from 'node:cluster'
import {runMaster} from './src/cluster/master.js'

if (cluster.isPrimary) {
    runMaster()
}